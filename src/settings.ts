import { App, Notice, PluginSettingTab, SecretComponent, Setting } from 'obsidian';
import type BasecampSyncPlugin from './main';
import { DEFAULT_BROKER_URL, type Settings } from './model';

export class BasecampSettingsTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: BasecampSyncPlugin) { super(app, plugin); }

  display(): void {
    const el = this.containerEl;
    el.empty();
    const settings = this.plugin.settings;
    const save = async () => { await this.plugin.saveSettings(); };
    new Setting(el).setName('Connection').setHeading();
    el.createEl('p', { text: 'Sync sends selected notes to Basecamp. Credentials stay in this device’s Secret storage. Connect separately on each device.' });
    new Setting(el).setName('Login method').addDropdown(dropdown => dropdown
      .addOption('shared', 'Shared mkdev integration').addOption('own', 'My own integration')
      .addOption('token', 'Existing access token').setValue(settings.authMode).onChange(async value => {
        settings.authMode = value as Settings['authMode']; await save(); this.display();
      }));
    if (settings.authMode === 'shared') {
      this.text('Login service URL', 'Uses mkdev’s hosted login service by default. Change this only for your own deployment.',
        'brokerUrl', DEFAULT_BROKER_URL);
    } else if (settings.authMode === 'own') {
      this.text('Client ID', 'From your Basecamp integration registration.', 'clientId');
      new Setting(el).setName('Client secret').setDesc('Choose your own integration secret. Never distribute it with the plugin.')
        .addComponent(container => new SecretComponent(this.app, container).setValue(settings.clientSecretName)
          .onChange(async value => { settings.clientSecretName = value; await save(); }));
      this.text('Redirect URI', 'Must exactly match the registered callback. An HTTPS callback URL can also be pasted below.', 'redirectUri');
    } else {
      new Setting(el).setName('Access token').setDesc('An existing bearer token. Replace it when it expires; this mode cannot refresh it.')
        .addComponent(container => new SecretComponent(this.app, container).setValue(settings.tokenSecretName)
          .onChange(async value => { settings.tokenSecretName = value; await save(); }));
    }
    if (settings.authMode !== 'token') {
      new Setting(el).setName(this.plugin.auth.connected() ? 'Connected on this device' : 'Connect on this device')
        .addButton(button => button.setButtonText('Connect to Basecamp').setCta().onClick(async () => {
          try { window.open(await this.plugin.auth.start()); }
          catch (error) { this.plugin.report(error); }
        })).addButton(button => button.setButtonText('Disconnect').onClick(() => {
          this.plugin.auth.disconnect(); this.display();
        }));
      let callback = '';
      new Setting(el).setName('Complete login manually').setDesc('If the browser does not return to Obsidian, paste the full callback URL. It is not saved.')
        .addText(text => text.setPlaceholder('Callback URL').onChange(value => { callback = value; }))
        .addButton(button => button.setButtonText('Complete login').onClick(async () => {
          try {
            await this.plugin.auth.callback(Object.fromEntries(new URL(callback).searchParams));
            callback = ''; this.display(); new Notice('Connected to Basecamp.');
          } catch (error) { this.plugin.report(error); }
        }));
    }

    new Setting(el).setName('Destination').setHeading();
    new Setting(el).setName('Load accounts').setDesc('Connect first, then choose the Basecamp account to publish into.')
      .addButton(button => button.setButtonText('Load accounts').onClick(async () => {
        try {
          const info = await this.plugin.client('1').authorization.getInfo({ endpoint: 'https://3.basecampapi.com/authorization.json' });
          accountChoices.empty();
          new Setting(accountChoices).setName('Account').addDropdown(dropdown => {
            dropdown.addOption('', 'Choose an account');
            for (const account of info.accounts) {
              if (account.href.startsWith('https://3.basecampapi.com/')) dropdown.addOption(String(account.id), account.name);
            }
            dropdown.setValue(settings.accountId).onChange(async value => {
              settings.accountId = value; settings.projectId = ''; settings.vaultId = ''; await save(); this.display();
            });
          });
        } catch (error) { this.plugin.report(error); }
      }));
    const accountChoices = el.createDiv();
    this.text('Account ID', 'Selected account; also accepts the ID from a Basecamp URL.', 'accountId');
    new Setting(el).setName('Load projects').addButton(button => button.setButtonText('Load projects').onClick(async () => {
      try {
        const projects = await this.plugin.client().projects.list();
        projectChoices.empty();
        new Setting(projectChoices).setName('Project').addDropdown(dropdown => {
          dropdown.addOption('', 'Choose a project');
          for (const project of projects) dropdown.addOption(String(project.id), project.name);
          dropdown.setValue(settings.projectId).onChange(async value => {
            try {
              settings.projectId = value;
              settings.vaultId = '';
              if (value) {
                const project = await this.plugin.client().projects.get(Number(value));
                settings.vaultId = String(project.dock?.find(tool => tool.name === 'vault' && tool.enabled)?.id || '');
              }
              await save(); this.display();
            } catch (error) { this.plugin.report(error); }
          });
        });
      } catch (error) { this.plugin.report(error); }
    }));
    const projectChoices = el.createDiv();
    this.text('Project ID', 'The project containing Docs & Files.', 'projectId');
    this.text('Docs & Files or folder ID', 'Loading a project selects its Docs & Files root. Paste a Basecamp folder ID to use a subfolder.', 'vaultId');

    new Setting(el).setName('Notes to sync').setHeading();
    el.createEl('p', { text: 'Source folder controls where paths start in Basecamp. Include chooses which notes to send. Your local files and folders stay where they are.' });
    this.text('Source folder', 'The folder in your vault that maps directly to the Basecamp destination above. Its name and parent folders are omitted from Basecamp paths. Only notes inside it can sync. Leave blank to keep the full vault path.',
      'sourceFolder', 'Projects/Writing/Basecamp');
    for (const [key, name, description] of [
      ['includes', 'Include', 'Choose notes using full paths from your vault root, including the source folder prefix. Enter one note, folder or pattern per line. A folder includes its subfolders; **/*.md matches Markdown notes at any depth. Empty selects nothing.'],
      ['excludes', 'Exclude', 'Optional. Use the same full vault paths or patterns as Include, one per line. Matches are skipped even if included. Set basecamp_sync: false in a note to skip it.'],
    ] as const) new Setting(el).setName(name).setDesc(description).addTextArea(text => text
      .setValue(settings[key].join('\n')).onChange(async value => {
        settings[key] = value.split('\n').map(item => item.trim()).filter(Boolean); await save();
      }));
    new Setting(el).setName('Preserve folders').setDesc('On: keep the subfolders below the source folder. Off: put every new document directly in the Basecamp destination. Existing linked documents stay in their current location.')
      .addToggle(toggle => toggle.setValue(settings.mirrorFolders).onChange(async value => { settings.mirrorFolders = value; await save(); }));
    const example = el.createDiv({ cls: 'basecamp-sync-preview' });
    example.createEl('strong', { text: 'Folder mapping example' });
    example.createEl('p', { text: 'With folder preservation on:' });
    for (const [label, path] of [
      ['Source folder: ', 'Work/Basecamp'],
      ['Include: ', 'Work/Basecamp/Articles'],
      ['Obsidian note: ', 'Work/Basecamp/Articles/Plan.md'],
      ['Basecamp location: ', 'Selected destination → Articles → Plan'],
    ]) {
      const row = example.createEl('p', { text: label });
      row.createEl('code', { text: path });
    }
    example.createEl('p', { text: 'Only the selected folder and its subfolders sync. The source folder and its parents are omitted from Basecamp paths.' });
    new Setting(el).setName('Upload local attachments').setDesc('Upload embedded images and files referenced by selected notes, up to 20 MB each. Embedded notes remain links.')
      .addToggle(toggle => toggle.setValue(settings.uploadAttachments).onChange(async value => { settings.uploadAttachments = value; await save(); }));
    new Setting(el).setName('Sync after edits on this device').setDesc('Runs only while Obsidian is open. Enable on one device at a time; allow vault sync to finish before switching devices.')
      .addToggle(toggle => toggle.setValue(settings.autoSync).onChange(async value => { settings.autoSync = value; await save(); }));
    new Setting(el).setName('Delay after edits').setDesc('Seconds to wait after the last edit, from 5 to 300.')
      .addText(text => text.setValue(String(settings.debounceSeconds)).onChange(async value => {
        const delay = Number(value);
        if (Number.isFinite(delay) && delay >= 5 && delay <= 300) { settings.debounceSeconds = delay; await save(); }
      }));
    new Setting(el).setDesc('Preview selection shows the notes and their Basecamp locations before anything is sent. Sync now publishes the selected notes and updates linked documents.')
      .addButton(button => button.setButtonText('Preview selection').onClick(() => { void this.plugin.showPlan(); }))
      .addButton(button => button.setButtonText('Sync now').setCta().onClick(() => { void this.plugin.sync(); }));
  }

  private text(name: string, description: string, key: 'brokerUrl' | 'clientId' | 'redirectUri' | 'accountId' | 'projectId' | 'vaultId' | 'sourceFolder', placeholder = ''): void {
    new Setting(this.containerEl).setName(name).setDesc(description).addText(text => text
      .setPlaceholder(placeholder).setValue(this.plugin.settings[key]).onChange(async value => {
        this.plugin.settings[key] = value.trim(); await this.plugin.saveSettings();
      }));
  }
}
