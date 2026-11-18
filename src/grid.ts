import type { ResourceDocument, ResourceFile, ResourceValue } from './resx';

export interface GridColumn extends ResourceFile {
	resource?: ResourceDocument;
	error?: string;
}

function placeholderIndexes(value: string): string[] {
	const indexes = new Set<string>();
	for (const match of value.matchAll(/\{\{|\{(\d+)[ ]*(?:,[ ]*-?\d+[ ]*)?(?::[^{}]*)?\}/g)) {
		if (match[1] !== undefined) {
			indexes.add(match[1].replace(/^0+(?=\d)/, ''));
		}
	}
	return [...indexes].sort();
}

function describeCell(value: ResourceValue | undefined, reference: ResourceValue | undefined, unavailable: boolean) {
	if (unavailable) {
		return { status: 'Unavailable' };
	}
	if (!value) {
		return { status: 'Missing' };
	}
	const typeMismatch = reference && value.kind !== reference.kind ? 'Resource type differs' : undefined;
	if (value.kind === 'non-string') {
		return { status: 'Non-string', warning: typeMismatch };
	}
	const text = value.text;
	if (!text.trim()) {
		return { text, status: text ? 'Whitespace only' : 'Empty', warning: typeMismatch };
	}
	const expected = reference?.kind === 'text' ? placeholderIndexes(reference.text) : undefined;
	const actual = placeholderIndexes(text);
	const warning = expected && (expected.length !== actual.length || expected.some((index, i) => index !== actual[i]))
		? `Expected format placeholders ${expected.map(index => '{' + index + '}').join(', ') || '(none)'}`
		: typeMismatch;
	return { text, warning };
}

export function gridData(columns: GridColumn[]) {
	const keys = new Set(columns.flatMap(column => [...(column.resource?.entries.keys() ?? [])]));
	return {
		files: columns.map(({ fileName, culture, error }) => ({ fileName, culture, error })),
		rows: [...keys].sort().map(key => {
			const entries = columns.map(column => column.resource?.entries.get(key));
			const values = entries.map(entry => entry?.value);
			const firstText = values.find(value => value?.kind === 'text' && value.text.trim());
			const neutral = columns[0]?.culture === undefined ? values[0] : undefined;
			const reference = neutral?.kind === 'text' && !neutral.text.trim()
				? firstText ?? neutral
				: neutral ?? firstText ?? values.find(Boolean);
			const cells = values.map((value, index) => {
				const cell = describeCell(value, reference, Boolean(columns[index].error));
				return value?.kind === 'non-string' ? { ...cell, searchValue: entries[index]?.valueElement?.text } : cell;
			});
			return { key, cells };
		}),
	};
}

function escapeHtml(text: string): string {
	return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

export function renderGrid(name: string, stylesheet: string, script: string, cspSource: string): string {
	const title = escapeHtml(name);
	const source = escapeHtml(cspSource);
	return `<!doctype html>
<html lang="en">
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${source}; script-src ${source};">
	<title>${title}</title>
	<link rel="stylesheet" href="${escapeHtml(stylesheet)}">
	<script defer src="${escapeHtml(script)}"></script>
</head>
<body>
	<main>
		<h1 id="family-name">${title}</h1>
		<div class="toolbar">
			<search>
				<label for="grid-search">Search keys and values</label>
				<input id="grid-search" type="search" autocomplete="off" spellcheck="false">
			</search>
			<div class="actions">
				<button id="add-key" type="button" disabled>Add key</button>
				<button id="sort-keys" type="button" disabled>Sort files by key</button>
				<button id="save-files" type="button" disabled>Save files</button>
			</div>
		</div>
		<p id="grid-message" role="status">Loading resources…</p>
		<ul id="errors" hidden></ul>
		<div class="table-wrapper" tabindex="0" role="region" aria-labelledby="family-name" hidden>
			<table aria-labelledby="family-name">
				<thead><tr id="grid-headers"></tr></thead>
				<tbody id="grid-rows"></tbody>
			</table>
		</div>
	</main>
	<dialog id="edit-dialog" aria-labelledby="dialog-title">
		<form id="edit-form" method="dialog">
			<h2 id="dialog-title"></h2>
			<p id="dialog-hint" hidden></p>
			<div id="dialog-fields"></div>
			<p id="dialog-error" role="alert" hidden></p>
			<div class="actions">
				<button id="cancel-edit" type="button">Cancel</button>
				<button id="submit-edit" type="submit"></button>
			</div>
		</form>
	</dialog>
</body>
</html>`;
}
