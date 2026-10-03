/** Build the actionable instruction shown when a project root is not trusted. */
export function untrustedGuidance(projectRoot: string): string {
	return `Trust this project root with: pi-lsp-onread trust add ${projectRoot}`;
}

/**
 * Authorize only an exact match. Both projectRoot and trustedRoots must already be canonical;
 * this pure gate intentionally does not canonicalize or infer trust for nested paths.
 */
export function authorize({ projectRoot, trustedRoots }: { projectRoot: string; trustedRoots: string[] }):
	| { allowed: true }
	| { allowed: false; reason: "untrusted_root"; guidance: string } {
	if (trustedRoots.includes(projectRoot)) return { allowed: true };
	return { allowed: false, reason: "untrusted_root", guidance: untrustedGuidance(projectRoot) };
}
