/** Append diagnostics as a text content item, leaving the host's result status untouched. */
export function combineResult<T>(originalContent: T[], diagnosticsBlock: string): T[] | Array<T | { type: "text"; text: string }> {
	if (!diagnosticsBlock) return originalContent;
	return [...originalContent, { type: "text", text: `\n\n${diagnosticsBlock}` }];
}
