import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { designerProjectEdit } from '../designer';
import { gridData, renderGrid } from '../grid';
import { deleteResource, findResourceFamily, readResx, setResource, sortResources } from '../resx';
import { scaffoldResx } from '../scaffold';
import type { XmlEdit } from '../xml';

function apply(xml: string, edits: XmlEdit[]): string {
	for (const { start, end, text } of [...edits].sort((left, right) => right.start - left.start)) {
		xml = xml.slice(0, start) + text + xml.slice(end);
	}
	return xml;
}

suite('RESX resource grid', () => {
	test('finds the same family from neutral and localized resources', () => {
		const files = ['Labels.App.hu.resx', 'Labels.App.en.resx', 'Labels.App.resx', 'Labels.App.zh-Hant-TW.resx',
			'Labels.App.notes.resx', 'Labels.resx', 'Labels.App.tmp', 'Errors.en.resx'];
		const expected = {
			name: 'Labels.App',
			files: [
				{ fileName: 'Labels.App.resx' },
				{ fileName: 'Labels.App.en.resx', culture: 'en' },
				{ fileName: 'Labels.App.hu.resx', culture: 'hu' },
				{ fileName: 'Labels.App.zh-Hant-TW.resx', culture: 'zh-Hant-TW' },
			],
		};
		assert.deepEqual(findResourceFamily('Labels.App.resx', files), expected);
		assert.deepEqual(findResourceFamily('Labels.App.hu.resx', files), expected);
		assert.deepEqual(findResourceFamily('Labels.hu.resx', ['Labels.hu.resx']), {
			name: 'Labels', files: [{ fileName: 'Labels.hu.resx', culture: 'hu' }],
		});
	});

	test('flags missing, blank, and mismatched format items', () => {
		const neutral = readResx(`<?xml version="1.0" encoding="utf-8"?>
			<root>
				<resheader name="version"><value>2.0</value></resheader>
				<data name="Greeting" xml:space="preserve"><value>  &lt;hi&gt; <![CDATA[& welcome]]> {{{0:D}}} {1,5} {{2}}</value><comment>Note</comment></data>
				<data name="Blank" type="System.String, mscorlib"><value /></data>
				<data name="Icon" mimetype="application/x-microsoft.net.object.bytearray.base64"><value>AAAA</value></data>
			</root>`);
		assert.deepEqual(neutral.entries.get('Greeting')?.value, {
			kind: 'text', text: '  <hi> & welcome {{{0:D}}} {1,5} {{2}}',
		});
		const hu = readResx('<root><data name="Greeting"><value>Szia {1}, {0}!</value></data></root>');
		const en = readResx('<root><data name="Greeting"><value>Hi {2}!</value></data></root>');
		const { rows } = gridData([
			{ fileName: 'Labels.resx', resource: neutral },
			{ fileName: 'Labels.hu.resx', culture: 'hu', resource: hu },
			{ fileName: 'Labels.en.resx', culture: 'en', resource: en },
		]);
		assert.deepEqual(rows[0].cells.map(cell => cell.status), ['Empty', 'Missing', 'Missing']);
		assert.deepEqual(rows[1].cells.map(cell => cell.warning), [undefined, undefined, 'Expected format placeholders {0}, {1}']);
		assert.equal(rows[2].cells[0].status, 'Non-string');
		assert.match(renderGrid('Labels <misc>', 'style.css', 'grid.js', 'example:'), /<title>Labels &lt;misc&gt;<\/title>/);
		assert.throws(() => readResx('<root><data name="Bad"></root>'));
		assert.throws(() => readResx('<root><data name="Same"/><data name="Same"/></root>'), /Duplicate resource key/);
	});

	test('edits resource XML ranges without rewriting metadata, comments, or line endings', () => {
		const source = '\uFEFF<root>\r\n' +
			'\t<resheader name="version"><value>2.0</value></resheader>\r\n' +
			'\t<data name="Zulu"><value xml:space="preserve"/><comment>Keep me</comment></data>\r\n' +
			'\t<!-- standalone -->\r\n' +
			'\t<data name="Alpha" type="System.Int32"><value>42</value></data>\r\n' +
			'</root>\r\n';
		const value = '🍃 < &\r\nnext';
		const sorted = apply(source, sortResources(source, readResx(source)));
		assert.deepEqual([...readResx(sorted).entries.keys()], ['Alpha', 'Zulu']);
		assert.equal(sorted.split('\r\n')[3], '\t<!-- standalone -->');
		const updated = apply(sorted, setResource(sorted, readResx(sorted), 'Zulu', value));
		assert.deepEqual(readResx(updated).entries.get('Zulu')?.value, { kind: 'text', text: value });
		assert.match(updated, /<value xml:space="preserve">.*<\/value><comment>Keep me<\/comment>/);
		assert.throws(() => setResource(updated, readResx(updated), 'Alpha', 'bad'), /non-string/);
		const added = apply(updated, setResource(updated, readResx(updated), 'New "<&', 'new value'));
		assert.deepEqual(readResx(added).entries.get('New "<&')?.value, { kind: 'text', text: 'new value' });
		assert.ok(!added.replaceAll('\r\n', '').includes('\n'));
		const deleted = apply(added, deleteResource(added, readResx(added), 'New "<&'));
		assert.equal(deleted, updated);
		const empty = '<root />';
		const filled = apply(empty, setResource(empty, readResx(empty), 'Empty', ''));
		assert.deepEqual(readResx(filled).entries.get('Empty')?.value, { kind: 'text', text: '' });
	});

	test('scaffolds schema-backed RESX files with optional string values', () => {
		const blank = scaffoldResx();
		assert.match(blank, /<xsd:schema/);
		assert.match(blank, /<resheader name="version"><value>2.0<\/value><\/resheader>/);
		assert.equal(readResx(blank).entries.size, 0);
		const neutral = readResx('<root><data name="Greeting"><value> &lt; &amp; </value></data>' +
			'<data name="Count" type="System.Int32"><value>42</value></data></root>');
		const seeded = readResx(scaffoldResx(neutral));
		assert.deepEqual([...seeded.entries.keys()], ['Greeting']);
		assert.deepEqual(seeded.entries.get('Greeting')?.value, { kind: 'text', text: ' < & ' });
	});

	test('configures automatic Designer.cs generation without duplicating project items', () => {
		const project = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup><TargetFramework>net10.0</TargetFramework></PropertyGroup>
  <ItemGroup>
    <!-- Keep this comment -->
    <EmbeddedResource Update="AppResources/Labels.resx" />
  </ItemGroup>
</Project>
`;
		const relative = 'AppResources/Labels.resx';
		const plan = designerProjectEdit(project, relative);
		assert.ok(plan.edit);
		const configured = apply(project, [plan.edit]);
		assert.equal(configured.match(/<EmbeddedResource/g)?.length, 1);
		assert.match(configured, /<Generator>MSBuild:Compile<\/Generator>/);
		assert.match(configured, /<StronglyTypedFileName>\$\(IntermediateOutputPath\)Labels\.Designer\.cs<\/StronglyTypedFileName>/);
		assert.match(configured, /<StronglyTypedNamespace>\$\(RootNamespace\)\.AppResources<\/StronglyTypedNamespace>/);
		assert.match(configured, /<!-- Keep this comment -->/);
		assert.equal(designerProjectEdit(configured, relative).edit, undefined);
		assert.throws(() => designerProjectEdit(project.replace('Update=', 'Remove='), relative), /already be included/);
		const legacy = configured.replace('MSBuild:Compile', 'ResXFileCodeGenerator');
		assert.throws(() => designerProjectEdit(legacy, relative), /different Generator/);
	});

	test('opens and reuses a side-by-side panel from the command', async () => {
		const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'netresx-test-'));
		const neutral = vscode.Uri.file(path.join(temp, 'Labels.resx'));
		const localized = vscode.Uri.file(path.join(temp, 'Labels.hu.resx'));
		const openGrid = 'netresx.openTranslationGrid';
		const grids = () => vscode.window.tabGroups.all.flatMap(group => group.tabs)
			.filter(tab => tab.input instanceof vscode.TabInputWebview && tab.label === 'Labels');
		try {
			await Promise.all([fs.writeFile(neutral.fsPath, '<root />'), fs.writeFile(localized.fsPath, '<root />')]);
			const source = await vscode.window.showTextDocument(neutral);
			await vscode.commands.executeCommand(openGrid);
			assert.equal(grids().length, 1);
			assert.notEqual(grids()[0].group.viewColumn, source.viewColumn);
			await vscode.commands.executeCommand(openGrid, localized);
			assert.equal(grids().length, 1);
		} finally {
			await vscode.window.tabGroups.close(grids());
			await fs.rm(temp, { recursive: true, force: true });
		}
	});
});
