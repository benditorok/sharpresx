import { SaxesParser } from 'saxes';

export interface XmlEdit {
	start: number;
	end: number;
	text: string;
}

export interface XmlElement {
	name: string;
	attributes: Record<string, string>;
	children: XmlElement[];
	text: string;
	start: number;
	openEnd: number;
	closeStart: number;
	end: number;
	selfClosing: boolean;
}

export function readXml(xml: string): XmlElement {
	const parser = new SaxesParser();
	const stack: XmlElement[] = [];
	let root: XmlElement | undefined;
	let start = 0;
	parser.on('opentagstart', () => {
		start = xml.lastIndexOf('<', parser.position - 1);
	});
	parser.on('opentag', tag => {
		const element: XmlElement = {
			name: tag.name, attributes: tag.attributes, children: [], text: '',
			start, openEnd: parser.position, closeStart: parser.position, end: parser.position, selfClosing: tag.isSelfClosing,
		};
		const parent = stack.at(-1);
		if (parent) {
			parent.children.push(element);
		} else {
			root = element;
		}
		stack.push(element);
	});
	const appendText = (text: string) => {
		const element = stack.at(-1);
		if (element) {
			element.text += text;
		}
	};
	parser.on('text', appendText);
	parser.on('cdata', appendText);
	parser.on('closetag', () => {
		const element = stack.pop()!;
		element.end = parser.position;
		element.closeStart = element.selfClosing ? element.end - 2 : xml.lastIndexOf('</', element.end - 1);
	});
	parser.write(xml).close();
	if (!root) {
		throw new Error('Expected an XML root element.');
	}
	return root;
}

export function escapeXml(text: string, attribute = false): string {
	if (/[^\u0009\u000a\u000d\u0020-\ud7ff\ue000-\ufffd\u{10000}-\u{10ffff}]/u.test(text)) {
		throw new Error('The text contains a character that XML 1.0 cannot store.');
	}
	const escaped = text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
		.replaceAll('\r', '&#13;').replaceAll('\n', '&#10;');
	return attribute ? escaped.replaceAll('"', '&quot;').replaceAll('\t', '&#9;') : escaped;
}

export function indentAt(xml: string, offset: number): string | undefined {
	const prefix = xml.slice(xml.lastIndexOf('\n', offset - 1) + 1, offset);
	return /^[\t ]*$/.test(prefix) ? prefix : undefined;
}

export function appendXmlChild(xml: string, parent: XmlElement, lines: string[]): XmlEdit {
	const newline = xml.includes('\r\n') ? '\r\n' : '\n';
	const parentIndent = indentAt(xml, parent.start) ?? '';
	const childIndent = parent.children.length ? indentAt(xml, parent.children[0].start) : undefined;
	const indent = childIndent ?? parentIndent + '  ';
	const block = lines.map(line => indent + line).join(newline);
	if (parent.selfClosing) {
		return {
			start: parent.closeStart, end: parent.end,
			text: '>' + newline + block + newline + parentIndent + '</' + parent.name + '>',
		};
	}
	const closingIndent = indentAt(xml, parent.closeStart);
	const start = closingIndent === undefined ? parent.closeStart : parent.closeStart - closingIndent.length;
	const text = closingIndent === undefined ? newline + block + newline + parentIndent : block + newline;
	return { start, end: start, text };
}
