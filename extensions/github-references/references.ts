import { fuzzyFilter, type AutocompleteItem } from "@earendil-works/pi-tui";

export type GitHubReferenceKind = "issue" | "pull-request";

export type GitHubReference = {
	kind: GitHubReferenceKind;
	number: number;
	title: string;
	updatedAt: string;
	isDraft: boolean;
};

type GitHubListItem = {
	number?: unknown;
	title?: unknown;
	updatedAt?: unknown;
	isDraft?: unknown;
};

export const MAX_ITEMS_PER_KIND = 500;
export const MAX_SUGGESTIONS = 20;

export function extractGitHubReferenceToken(textBeforeCursor: string): string | undefined {
	const match = textBeforeCursor.match(/(?:^|[ \t])#([^\s#]*)$/);
	return match?.[1];
}

export function parseGitHubReferences(json: string, kind: GitHubReferenceKind): GitHubReference[] {
	const parsed: unknown = JSON.parse(json);
	if (!Array.isArray(parsed)) {
		throw new Error("expected a JSON array");
	}

	return parsed.map((item, index) => {
		const value = item as GitHubListItem;
		if (
			typeof value.number !== "number" ||
			typeof value.title !== "string" ||
			typeof value.updatedAt !== "string"
		) {
			throw new Error(`invalid item at index ${index}`);
		}

		return {
			kind,
			number: value.number,
			title: value.title,
			updatedAt: value.updatedAt,
			isDraft: kind === "pull-request" && value.isDraft === true,
		};
	});
}

export function sortGitHubReferences(references: GitHubReference[]): GitHubReference[] {
	return [...references].sort((left, right) => {
		const updatedDifference = Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
		return updatedDifference || right.number - left.number;
	});
}

function formatReferenceItem(reference: GitHubReference): AutocompleteItem {
	const kind = reference.kind === "issue" ? "issue" : reference.isDraft ? "draft PR" : "PR";
	return {
		value: `#${reference.number}`,
		label: `#${reference.number}`,
		description: `[${kind}] ${reference.title}`,
	};
}

export function filterGitHubReferences(references: GitHubReference[], query: string): AutocompleteItem[] {
	const normalizedQuery = query.trim();
	if (!normalizedQuery) {
		return references.slice(0, MAX_SUGGESTIONS).map(formatReferenceItem);
	}

	if (/^\d+$/.test(normalizedQuery)) {
		const numericMatches = references
			.filter((reference) => String(reference.number).startsWith(normalizedQuery))
			.slice(0, MAX_SUGGESTIONS)
			.map(formatReferenceItem);
		if (numericMatches.length > 0) {
			return numericMatches;
		}
	}

	return fuzzyFilter(references, normalizedQuery, (reference) => {
		const kind = reference.kind === "issue" ? "issue" : reference.isDraft ? "draft pull request pr" : "pull request pr";
		return `${reference.number} ${kind} ${reference.title}`;
	})
		.slice(0, MAX_SUGGESTIONS)
		.map(formatReferenceItem);
}
