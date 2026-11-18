import { appendXmlChild, escapeXml, indentAt, readXml, type XmlEdit, type XmlElement } from './xml';

const extension = '.resx';
const languageNames = new Intl.DisplayNames('en', { type: 'language', fallback: 'none' });

export interface ResourceFile {
	fileName: string;
	culture?: string;
}

export type ResourceValue = { kind: 'text'; text: string } | { kind: 'non-string' };

export function cultureSuffix(suffix: string): string | undefined {
	if (!/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(suffix)) {
		return undefined;
	}
	try {
		const locale = new Intl.Locale(suffix);
		if (languageNames.of(locale.language)) {
			return locale.baseName;
		}
	} catch (error) {
		if (!(error instanceof RangeError)) {
			throw error;
		}
	}
	return undefined;
}

export function findResourceFamily(selectedFileName: string, siblings: string[]) {
	const stem = selectedFileName.slice(0, -extension.length);
	const lastDot = stem.lastIndexOf('.');
	const fileNames = siblings.filter(fileName => fileName.endsWith(extension));
	const hasLocaleChildren = fileNames.some(fileName => {
		return fileName.startsWith(stem + '.') &&
			cultureSuffix(fileName.slice(stem.length + 1, -extension.length));
	});
	const name = !hasLocaleChildren && lastDot > 0 && cultureSuffix(stem.slice(lastDot + 1))
		? stem.slice(0, lastDot)
		: stem;
	return { name, files: listResourceFiles(name, fileNames) };
}

export function listResourceFiles(name: string, siblings: string[]): ResourceFile[] {
	const files: ResourceFile[] = [];
	for (const fileName of siblings.filter(fileName => fileName.endsWith(extension))) {
		if (fileName === name + extension) {
			files.push({ fileName });
		} else if (fileName.startsWith(name + '.')) {
			const culture = cultureSuffix(fileName.slice(name.length + 1, -extension.length));
			if (culture) {
				files.push({ fileName, culture });
			}
		}
	}
	files.sort((left, right) => (left.culture ?? '').localeCompare(right.culture ?? '', 'en') ||
		left.fileName.localeCompare(right.fileName, 'en'));
	return files;
}

export interface ResourceEntry {
	element: XmlElement;
	valueElement?: XmlElement;
	value: ResourceValue;
}

export interface ResourceDocument {
	root: XmlElement;
	entries: Map<string, ResourceEntry>;
}

export function readResx(xml: string): ResourceDocument {
	const root = readXml(xml);
	if (root.name !== 'root') {
		throw new Error('Expected a RESX <root> element.');
	}
	const entries = new Map<string, ResourceEntry>();
	for (const element of root.children) {
		if (element.name !== 'data') {
			continue;
		}
		const { name: key, type, mimetype } = element.attributes;
		if (key === undefined || entries.has(key)) {
			throw new Error(key === undefined ? 'A <data> element is missing its name.' : `Duplicate resource key "${key}".`);
		}
		const values = element.children.filter(child => child.name === 'value');
		const valueElement = values[0];
		const isString = mimetype === undefined &&
			(type === undefined || type.split(',')[0].trim() === 'System.String');
		if (isString && (values.length > 1 || valueElement?.children.length)) {
			throw new Error(`Resource "${key}" has an invalid <value> element.`);
		}
		const value: ResourceValue = isString
			? { kind: 'text', text: valueElement?.text ?? '' }
			: { kind: 'non-string' };
		entries.set(key, { element, valueElement, value });
	}
	return { root, entries };
}

export function resourceMarkup(key: string, value: string): string[] {
	return [`<data name="${escapeXml(key, true)}" xml:space="preserve">`,
		`  <value>${escapeXml(value)}</value>`, '</data>'];
}

export function setResource(xml: string, resource: ResourceDocument, key: string, value: string): XmlEdit[] {
	const entry = resource.entries.get(key);
	if (!entry) {
		return [appendXmlChild(xml, resource.root, resourceMarkup(key, value))];
	}
	if (entry.value.kind !== 'text') {
		throw new Error(`"${key}" is a non-string resource.`);
	}
	const escaped = escapeXml(value);
	const element = entry.valueElement;
	if (!element) {
		return [appendXmlChild(xml, entry.element, [`<value>${escaped}</value>`])];
	}
	if (entry.value.text === value) {
		return [];
	}
	return [element.selfClosing
		? { start: element.closeStart, end: element.end, text: `>${escaped}</value>` }
		: { start: element.openEnd, end: element.closeStart, text: escaped }];
}

export function deleteResource(xml: string, resource: ResourceDocument, key: string): XmlEdit[] {
	const entry = resource.entries.get(key);
	if (!entry) {
		return [];
	}
	const { start, end } = entry.element;
	const indent = indentAt(xml, start);
	const lineEnd = xml.indexOf('\n', end);
	if (indent !== undefined && lineEnd >= 0 && /^[\t \r]*$/.test(xml.slice(end, lineEnd))) {
		return [{ start: start - indent.length, end: lineEnd + 1, text: '' }];
	}
	return [{ start, end, text: '' }];
}

export function nextDuplicateKey(key: string, keys: ReadonlySet<string>): string {
	let suffix = 1;
	while (keys.has(key + suffix)) {
		suffix++;
	}
	return key + suffix;
}

export function duplicateResource(xml: string, resource: ResourceDocument, key: string, duplicateKey: string): XmlEdit[] {
	const entry = resource.entries.get(key);
	if (!entry) {
		return [];
	}
	const { start, openEnd, end } = entry.element;
	const open = xml.slice(start, openEnd).replace(/(\s+)([^\s=]+)(\s*=\s*)(["'])(.*?)\4/gs,
		(attribute, prefix: string, name: string, equals: string) =>
			name === 'name' ? `${prefix}${name}${equals}"${escapeXml(duplicateKey, true)}"` : attribute);
	return [appendXmlChild(xml, resource.root, [open + xml.slice(openEnd, end)])];
}

export function sortResources(xml: string, resource: ResourceDocument): XmlEdit[] {
	const original = [...resource.entries];
	const sorted = [...original].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
	return original.flatMap(([key, entry], index) => {
		const [sortedKey, target] = sorted[index];
		return key === sortedKey ? [] : [{
			start: entry.element.start, end: entry.element.end,
			text: xml.slice(target.element.start, target.element.end),
		}];
	});
}
