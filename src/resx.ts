import { SaxesParser } from 'saxes';

const extension = '.resx';
const languageNames = new Intl.DisplayNames('en', { type: 'language', fallback: 'none' });

export interface ResourceFile {
	fileName: string;
	culture?: string;
}

export type ResourceValue = { kind: 'text'; text: string } | { kind: 'non-string' };

function cultureSuffix(suffix: string): string | undefined {
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
	const files: ResourceFile[] = [];
	for (const fileName of fileNames) {
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
	return { name, files };
}

export function parseResx(xml: string): Map<string, ResourceValue> {
	const entries = new Map<string, ResourceValue>();
	const elements: string[] = [];
	const parser = new SaxesParser();
	let entry: { key: string; isString: boolean; text: string } | undefined;

	parser.on('opentag', tag => {
		elements.push(tag.name);
		if (elements.length === 1 && tag.name !== 'root') {
			throw new Error('Expected a RESX <root> element.');
		}
		if (elements.length === 2 && tag.name === 'data') {
			const { name: key, type, mimetype } = tag.attributes;
			if (key === undefined || entries.has(key)) {
				throw new Error(key === undefined ? 'A <data> element is missing its name.' : `Duplicate resource key "${key}".`);
			}
			const isString = mimetype === undefined &&
				(type === undefined || type.split(',')[0].trim() === 'System.String');
			entry = { key, isString, text: '' };
		}
	});
	const appendValue = (text: string) => {
		if (entry?.isString && elements.length === 3 && elements[2] === 'value') {
			entry.text += text;
		}
	};
	parser.on('text', appendValue);
	parser.on('cdata', appendValue);
	parser.on('closetag', () => {
		if (entry && elements.length === 2) {
			entries.set(entry.key, entry.isString ? { kind: 'text', text: entry.text } : { kind: 'non-string' });
			entry = undefined;
		}
		elements.pop();
	});
	parser.write(xml).close();
	return entries;
}
