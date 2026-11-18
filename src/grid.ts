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

function iconButton(id: string, label: string, path: string, hidden = false): string {
	return `<button id="${id}" class="tool-button" type="button" aria-label="${label}" title="${label}" disabled${hidden ? ' hidden' : ''}>
		<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${path}"></path></svg>
	</button>`;
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
		<div class="toolbar">
			<div class="actions" role="group" aria-label="Resource actions">
				${iconButton('add-key', 'Add key', 'M12 5v14M5 12h14')}
				${iconButton('delete-keys', 'Delete selected keys', 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7m4-7v7')}
				${iconButton('duplicate-key', 'Duplicate selected keys', 'M8 8h12v12H8zM16 8V4H4v12h4')}
				${iconButton('sort-keys', 'Sort files by key', 'M5 6h14M5 11h10M5 16h6m6-2v7m-3-3 3 3 3-3')}
				${iconButton('revert-files', 'Revert unsaved changes', 'M4 11h11a5 5 0 0 1 0 10h-3M4 11l6-6m-6 6 6 6', true)}
				${iconButton('save-files', 'Save files', 'M5 4h12l3 3v13H4V4zm3 0v6h8V4M8 20v-6h8v6')}
			</div>
			<div id="revert-confirmation" role="group" aria-labelledby="revert-label" hidden>
				<span id="revert-label">Discard unsaved changes in these RESX files?</span>
				<button id="revert-cancel" type="button">Cancel</button>
				<button id="revert-confirm" type="button">Revert</button>
			</div>
			<p id="grid-message" role="status"></p>
			<search>
				<input id="grid-search" type="search" aria-label="Search keys and values"
					placeholder="Search keys and values" autocomplete="off" spellcheck="false">
			</search>
		</div>
		<p id="grid-empty" role="status"></p>
		<ul id="errors" hidden></ul>
		<div class="table-wrapper" tabindex="0" role="region" aria-label="Resource entries" hidden>
			<table aria-label="RESX resources">
				<thead><tr id="grid-headers"></tr></thead>
				<tbody id="grid-rows"></tbody>
			</table>
		</div>
	</main>
</body>
</html>`;
}
