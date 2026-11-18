import type { ResourceFile, ResourceValue } from './resx';

export interface ResourceColumn extends ResourceFile {
	entries: Map<string, ResourceValue>;
}

function escapeHtml(text: string): string {
	return text
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;');
}

function renderCell(value: ResourceValue | undefined, culture: string | undefined): string {
	if (value?.kind === 'text' && value.text !== '') {
		const lang = culture ? ` lang="${escapeHtml(culture)}"` : '';
		return `<td class="translation" dir="auto"${lang}>${escapeHtml(value.text)}</td>`;
	}
	const status = value === undefined ? 'Missing' : value.kind === 'non-string' ? 'Non-string' : 'Empty';
	return `<td class="status">${status}</td>`;
}

export function renderGrid(name: string, columns: ResourceColumn[], stylesheet: string, cspSource: string): string {
	const title = `${escapeHtml(name)} Translations`;
	const keys = [...new Set(columns.flatMap(column => [...column.entries.keys()]))];
	const headers = columns.map(({ culture, fileName }) =>
		`<th scope="col" title="${escapeHtml(fileName)}">${escapeHtml(culture ?? 'Default')}</th>`
	).join('');
	const rows = keys.map(key => `
		<tr><th scope="row">${escapeHtml(key)}</th>${columns.map(({ culture, entries }) =>
			renderCell(entries.get(key), culture)).join('')}</tr>`).join('');
	return `<!doctype html>
<html lang="en">
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${escapeHtml(cspSource)};">
	<title>${title}</title>
	<link rel="stylesheet" href="${escapeHtml(stylesheet)}">
</head>
<body>
	<main>
		${keys.length ? `
		<div class="table-wrapper" tabindex="0" role="region" aria-labelledby="family-name">
			<table>
				<caption><h1 id="family-name">${title}</h1></caption>
				<thead><tr><th scope="col">Key</th>${headers}</tr></thead>
				<tbody>${rows}</tbody>
			</table>
		</div>` : `<h1>${title}</h1><p>No resource entries found.</p>`}
	</main>
</body>
</html>`;
}
