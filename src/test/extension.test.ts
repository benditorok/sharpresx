import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { renderGrid } from '../grid';
import { findResourceFamily, parseResx } from '../resx';

suite('RESX translation grid', () => {
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
			name: 'Labels',
			files: [{ fileName: 'Labels.hu.resx', culture: 'hu' }],
		});
	});

	test('renders XML text safely and distinguishes empty, missing, and non-string entries', () => {
		const neutral = parseResx(`<?xml version="1.0" encoding="utf-8"?>
			<root>
				<resheader name="version"><value>2.0</value></resheader>
				<data name="Greeting" xml:space="preserve"><value>  &lt;hi&gt; <![CDATA[& welcome]]> </value><comment>Note</comment></data>
				<data name="Blank" type="System.String, mscorlib"><value /></data>
				<data name="Icon" mimetype="application/x-microsoft.net.object.bytearray.base64"><value>AAAA</value></data>
			</root>`);
		assert.deepEqual(neutral, new Map([
			['Greeting', { kind: 'text', text: '  <hi> & welcome ' }],
			['Blank', { kind: 'text', text: '' }],
			['Icon', { kind: 'non-string' }],
		]));
		const hungarian = parseResx('<root><data name="Greeting"><value>Szia!</value></data></root>');
		const html = renderGrid('Labels', [
			{ fileName: 'Labels.resx', entries: neutral },
			{ fileName: 'Labels.hu.resx', culture: 'hu', entries: hungarian },
		], 'style.css', 'example:');

		assert.match(html, /<th scope="row">Greeting<\/th>/);
		assert.match(html, /&lt;hi&gt; &amp; welcome/);
		assert.match(html, /lang="hu">Szia!/);
		assert.match(html, />Empty<\/td><td class="status">Missing<\/td>/);
		assert.match(html, />Non-string<\/td>/);
		assert.throws(() => parseResx('<root><data name="Bad"></root>'));
	});

	test('opens and reuses a side-by-side panel from the command', async () => {
		const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'netresx-test-'));
		const neutral = vscode.Uri.file(path.join(temp, 'Labels.resx'));
		const localized = vscode.Uri.file(path.join(temp, 'Labels.hu.resx'));
		const openGrid = 'netresx.openTranslationGrid';
		const grids = () => vscode.window.tabGroups.all.flatMap(group => group.tabs)
			.filter(tab => tab.input instanceof vscode.TabInputWebview &&
				tab.label === 'Labels Translations');
		try {
			await Promise.all([fs.writeFile(neutral.fsPath, '<root />'), fs.writeFile(localized.fsPath, '<root />')]);
			const source = await vscode.window.showTextDocument(neutral);
			await vscode.commands.executeCommand(openGrid);
			assert.equal(grids().length, 1);
			assert.equal(grids()[0].label, 'Labels Translations');
			assert.notEqual(grids()[0].group.viewColumn, source.viewColumn);
			await vscode.commands.executeCommand(openGrid, localized);
			assert.equal(grids().length, 1);
		} finally {
			await vscode.window.tabGroups.close(grids());
			await fs.rm(temp, { recursive: true, force: true });
		}
	});
});
