const parseMarkdown = (text) => {
    if (!text) return '';
    
    // First, process headers, bold, italic, code, links, etc.
    let processed = text
        // Headers (####, ###, ##, #) - process from largest to smallest to avoid conflicts
        .replace(/^#### (.*$)/gim, '<h4 class="text-lg font-semibold text-gray-800 mb-3 mt-4 first:mt-0">$1</h4>')
        .replace(/^### (.*$)/gim, '<h3 class="text-xl font-bold text-gray-900 mb-3 mt-5 first:mt-0">$1</h3>')
        .replace(/^## (.*$)/gim, '<h2 class="text-2xl font-bold text-gray-900 mb-4 mt-6 first:mt-0 border-b border-gray-200 pb-2">$1</h2>')
        .replace(/^# (.*$)/gim, '<h1 class="text-3xl font-bold text-gray-900 mb-5 mt-6 first:mt-0">$1</h1>')
        
        // Bold text (**text** or __text__)
        .replace(/\*\*(.*?)\*\*/g, '<strong class="font-semibold text-gray-900">$1</strong>')
        .replace(/__(.*?)__/g, '<strong class="font-semibold text-gray-900">$1</strong>')
        
        // Italic text (*text* or _text_)
        .replace(/\*(.*?)\*/g, '<em class="italic text-gray-700">$1</em>')
        .replace(/_(.*?)_/g, '<em class="italic text-gray-700">$1</em>')
        
        // Code blocks (```code```)
        .replace(/```([\s\S]*?)```/g, '<pre class="bg-gray-100 border border-gray-200 rounded-lg p-4 text-sm font-mono text-gray-800 mb-4 overflow-x-auto"><code>$1</code></pre>')
        
        // Inline code (`code`)
        .replace(/`([^`]+)`/g, '<code class="bg-gray-100 px-2 py-1 rounded text-sm font-mono text-gray-800 border border-gray-200">$1</code>')
        
        // Blockquotes (> text)
        .replace(/^> (.*$)/gim, '<blockquote class="border-l-4 border-blue-500 pl-4 py-2 my-3 bg-blue-50 text-gray-700 italic">$1</blockquote>')
        
        // Horizontal rules (--- or ***)
        .replace(/^---$/gim, '<hr class="border-t border-gray-300 my-6">')
        .replace(/^\*\*\*$/gim, '<hr class="border-t border-gray-300 my-6">')
        
        // Links [text](url)
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="text-blue-600 hover:text-blue-800 underline" target="_blank" rel="noopener noreferrer">$1</a>');
    
    const lines = processed.split('\n');
    const result = [];
    let inList = false;
    let listStack = [];
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const listMatch = line.match(/^(\s*)(\*|\-|\d+\.) (.+)$/);
        
        if (listMatch) {
            const [, spaces, marker, content] = listMatch;
            const level = Math.floor(spaces.length / 2);
            const isOrdered = /\d+\./.test(marker);
            
            // Close any open lists at deeper levels
            while (listStack.length > level) {
                const lastList = listStack.pop();
                result.push(`</${lastList.tag}>`);
            }
            
            // Open new list if needed
            if (listStack.length < level) {
                const listTag = isOrdered ? 'ol' : 'ul';
                const marginLeftInRem = 1.5 + level * 0.5;
                result.push(`<${listTag} class="${isOrdered ? 'list-decimal' : 'list-disc'} mb-3 space-y-1" style="margin-left: ${marginLeftInRem}rem;">`);
                listStack.push({ tag: listTag, level });
            }
            
            // Add list item
            result.push(`<li class="text-gray-700 leading-relaxed">${content}</li>`);
            inList = true;
        } else {
            // Close all open lists if we're not in a list anymore
            if (inList && !line.trim().startsWith('<')) {
                while (listStack.length > 0) {
                    const lastList = listStack.pop();
                    result.push(`</${lastList.tag}>`);
                }
                inList = false;
            }
            result.push(line);
        }
    }
    
    // Close any remaining open lists
    while (listStack.length > 0) {
        const lastList = listStack.pop();
        result.push(`</${lastList.tag}>`);
    }
    
    return result.join('\n').replace(/\n/g, '<br>');
};

export default parseMarkdown;