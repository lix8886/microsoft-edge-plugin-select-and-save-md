// background.js

// 初始化菜单
chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
        id: "save-selection-md",
        title: "保存选中内容为 Markdown",
        contexts: ["selection"]
    });
});

/**
 * 注入脚本：将选中的 HTML 转换为 Markdown
 * 优化：所有链接和图片路径均会自动补全为绝对路径 (https://...)
 */
function getMarkdownFromSelection() {
    const selection = window.getSelection();
    if (!selection.rangeCount) return null;

    // 1. 获取选区的 HTML 内容
    const container = document.createElement("div");
    container.appendChild(selection.getRangeAt(0).cloneContents());

    // 辅助函数：将相对路径转换为绝对路径
    function toAbsoluteUrl(urlStr) {
        if (!urlStr) return "";
        try {
            // document.baseURI 会自动处理 <base> 标签和当前页面 URL
            return new URL(urlStr, document.baseURI).href;
        } catch (e) {
            return urlStr; // 如果解析失败，返回原字符串
        }
    }

    // 2. HTML 转 Markdown 转换器
    function domToMarkdown(node) {
        // 文本节点
        if (node.nodeType === Node.TEXT_NODE) {
            // 简单的转义，防止 * 或 # 破坏格式，但保留必要的空格
            // 可以在这里增加更严格的转义逻辑
            return node.textContent;
        }

        // 元素节点
        if (node.nodeType === Node.ELEMENT_NODE) {
            const tagName = node.tagName.toLowerCase();
            let content = "";

            // 递归处理子节点
            for (let child of node.childNodes) {
                content += domToMarkdown(child);
            }

            // 根据标签类型包裹 Markdown 语法
            switch (tagName) {
                case 'b':
                case 'strong':
                    return content.trim() ? ` **${content}** ` : "";

                case 'i':
                case 'em':
                    return content.trim() ? ` *${content}* ` : "";

                case 'u':
                    return ` <u>${content}</u> `;

                case 'h1': return `\n# ${content}\n`;
                case 'h2': return `\n## ${content}\n`;
                case 'h3': return `\n### ${content}\n`;
                case 'h4': return `\n#### ${content}\n`;

                case 'a':
                    const href = node.getAttribute('href');
                    // 补全为绝对路径
                    const fullHref = toAbsoluteUrl(href);

                    // 过滤掉 javascript: 等无效链接，或者是没有链接的情况
                    if (!fullHref || fullHref.startsWith('javascript:')) {
                        return content;
                    }
                    return `[${content}](${fullHref})`;

                case 'code':
                    return ` \`${content}\` `;

                case 'pre':
                    return `\n\`\`\`\n${content}\n\`\`\`\n`;

                case 'li':
                    return `\n- ${content}`;

                case 'p':
                case 'div':
                case 'section':
                case 'article':
                    return `\n${content}\n`;

                case 'br':
                    return `\n`;

                case 'img':
                    const src = node.getAttribute('src');
                    // 补全为绝对路径
                    const fullSrc = toAbsoluteUrl(src);
                    const alt = node.getAttribute('alt') || 'image';

                    if (!fullSrc) return ""; // 没有图片的 src 则不显示
                    return `\n![${alt}](${fullSrc})\n`;

                default:
                    return content;
            }
        }
        return "";
    }

    // 3. 执行转换并清理多余空行
    let markdown = domToMarkdown(container);
    return markdown.replace(/\n{3,}/g, "\n\n").trim();
}


// --- 辅助工具函数 ---

function getBeijingTime() {
    const now = new Date();
    const options = {
        timeZone: "Asia/Shanghai",
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false
    };
    const formatter = new Intl.DateTimeFormat('zh-CN', options);
    const parts = formatter.formatToParts(now);

    const getVal = (t) => parts.find(p => p.type === t).value;

    return {
        full: `${getVal('year')}-${getVal('month')}-${getVal('day')} ${getVal('hour')}:${getVal('minute')}:${getVal('second')}`,
        file: `${getVal('year')}${getVal('month')}${getVal('day')}-${getVal('hour')}${getVal('minute')}${getVal('second')}`
    };
}

function extractDomain(urlStr) {
    try {
        return new URL(urlStr).hostname.replace(/^www\./, "");
    } catch { return "unknown"; }
}

function sanitizeFilename(name) {
    return name.replace(/[<>:"/\\|?*\x00-\x1F\s]+/g, "_").slice(0, 80);
}

function createDataUrl(content) {
    const encoder = new TextEncoder();
    const data = encoder.encode(content);
    let binary = '';
    for (let i = 0; i < data.byteLength; i++) {
        binary += String.fromCharCode(data[i]);
    }
    return `data:text/markdown;charset=utf-8;base64,${btoa(binary)}`;
}


// --- 主逻辑 ---

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId !== "save-selection-md") return;

    let contentMD = "";

    // 1. 尝试注入脚本获取 Markdown
    try {
        const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: getMarkdownFromSelection
        });
        contentMD = results[0]?.result;
    } catch (e) {
        console.warn("脚本注入失败，回退到纯文本", e);
    }

    // 2. 回退处理
    if (!contentMD) {
        contentMD = info.selectionText || "";
    }

    // 3. 准备文件内容
    const pageUrl = tab.url || "";
    const timeData = getBeijingTime();
    const fileContent = `URL: [${pageUrl}](${pageUrl})
Saved: ${timeData.full}

${contentMD}
`;

    // 4. 下载
    const domain = extractDomain(pageUrl);
    const filename = `${sanitizeFilename(domain)}_${timeData.file}.md`;

    chrome.downloads.download({
        url: createDataUrl(fileContent),
        filename: filename,
        conflictAction: "uniquify",
        saveAs: false
    });
});