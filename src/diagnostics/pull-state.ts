export class PullState {
	private readonly resultIds = new Map<string, string>();

	get(serverId: string, uri: string): string | undefined {
		return this.resultIds.get(this.key(serverId, uri));
	}

	set(serverId: string, uri: string, resultId: string): void {
		this.resultIds.set(this.key(serverId, uri), resultId);
	}

	private key(serverId: string, uri: string): string {
		return JSON.stringify([serverId, uri]);
	}
}
