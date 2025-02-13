// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { simpleGit, SimpleGit } from 'simple-git';

interface GitRepositoryConfig {
    baseFolders?: string[];
    ignoredFolders?: string[];
    maxDepth?: number;
    scanMode?: 'workspace' | 'custom' | 'both';
}

async function findGitRepositories(): Promise<string[]> {
    const config = vscode.workspace.getConfiguration('iallauto.git');
    const settings: GitRepositoryConfig = {
        baseFolders: config.get('baseFolders'),
        ignoredFolders: config.get('ignoredFolders', ['node_modules', 'out', 'typings', 'test']),
        maxDepth: config.get('maxDepth', 2),
        scanMode: config.get('scanMode', 'workspace')
    };

    const repositories: Set<string> = new Set();
    const pathsToScan: Set<string> = new Set();

    // 1. Get all open text document paths
    const openDocs = vscode.workspace.textDocuments
        .filter(doc => doc.uri.scheme === 'file' && !doc.isUntitled)
        .map(doc => path.dirname(doc.uri.fsPath))
        .filter(isValidPath);

    // Add all unique parent directories of open files (up to 3 levels up)
    for (const docPath of openDocs) {
        let currentPath = docPath;
        for (let i = 0; i < 3; i++) {
            if (isValidPath(currentPath)) {
                pathsToScan.add(currentPath);
            }
            const parentPath = path.dirname(currentPath);
            if (parentPath === currentPath) break;
            currentPath = parentPath;
        }
    }

    // 2. Add workspace folders if enabled
    if (settings.scanMode !== 'custom') {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders) {
            workspaceFolders
                .map(folder => folder.uri.fsPath)
                .filter(isValidPath)
                .forEach(path => pathsToScan.add(path));
        }
    }

    // 3. Add custom base folders if configured
    if (settings.scanMode !== 'workspace' && settings.baseFolders && settings.baseFolders.length > 0) {
        settings.baseFolders
            .map(expandPath)
            .filter(isValidPath)
            .forEach(path => pathsToScan.add(path));
    }

    // Log scanning paths for debugging
    console.log('Paths to scan:', Array.from(pathsToScan));

    // If no valid paths found, show configuration message
    if (pathsToScan.size === 0) {
        vscode.window.showWarningMessage(
            'No valid workspace or repository paths found. Would you like to configure repository paths?',
            'Configure Now'
        ).then(selection => {
            if (selection === 'Configure Now') {
                vscode.commands.executeCommand('workbench.action.openSettings', 'iallauto.git.baseFolders');
            }
        });
        return [];
    }

    // Scan all valid paths for repositories
    for (const dirPath of pathsToScan) {
        try {
            // Quick check if this path itself is a git repo
            const git = simpleGit(dirPath);
            const isRepo = await git.checkIsRepo();
            if (isRepo) {
                repositories.add(dirPath);
                continue; // No need to scan subdirectories if this is already a repo
            }

            // If not a repo, scan subdirectories
            await scanDirectory(dirPath, 0, settings, repositories);
        } catch (error) {
            console.error(`Error scanning directory ${dirPath}:`, error);
        }
    }

    // Sort repositories by path length (shorter paths first)
    return Array.from(repositories).sort((a, b) => a.length - b.length);
}

function isValidPath(p: string): boolean {
    // Don't allow root directory or very short paths
    if (p === '/' || p === '\\' || p.length < 3) {
        return false;
    }

    try {
        // Check if path exists and is a directory
        return require('fs').statSync(p).isDirectory();
    } catch (error) {
        return false;
    }
}

function expandPath(p: string): string {
    // Handle environment variables
    const expanded = p.replace(/\$([A-Za-z0-9_]+)/g, (_, name) => process.env[name] || '');
    
    // Handle home directory shorthand
    if (expanded.startsWith('~/')) {
        return path.join(process.env.HOME || process.env.USERPROFILE || '', expanded.slice(2));
    }

    return expanded;
}

async function scanDirectory(
    directory: string,
    depth: number,
    config: GitRepositoryConfig,
    repositories: Set<string>
): Promise<void> {
    try {
        // Check depth limit
        if (depth > (config.maxDepth || 2)) {
            return;
        }

        // Check if directory should be ignored
        const dirName = path.basename(directory);
        if (config.ignoredFolders?.some(pattern => {
            if (pattern.includes('*')) {
                return new RegExp('^' + pattern.replace(/\*/g, '.*') + '$').test(dirName);
            }
            return pattern === dirName;
        })) {
            return;
        }

        // Check if directory is a git repository
        const git = simpleGit(directory);
        const isRepo = await git.checkIsRepo();
        if (isRepo) {
            repositories.add(directory);
            // Don't scan deeper if we found a repository
            return;
        }

        // Scan subdirectories
        const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(directory));
        for (const [name, type] of entries) {
            if (type === vscode.FileType.Directory) {
                await scanDirectory(path.join(directory, name), depth + 1, config, repositories);
            }
        }
    } catch (error) {
        console.error(`Error scanning directory ${directory}:`, error);
    }
}

interface GitFileStatus {
    path: string;
    repoPath: string;
    isVersioned: boolean;
}

interface GitStatus {
    repositories: {
        [repoPath: string]: {
            versioned: string[];
            unversioned: string[];
        }
    };
}

class CommitViewProvider implements vscode.WebviewViewProvider {
    private _view?: vscode.WebviewView;
    private _gitRepos: Map<string, SimpleGit> = new Map();
    private _extensionPath: string;

    constructor(
        extensionPath: string,
        private readonly _extensionUri: vscode.Uri,
        private readonly _repositories: string[]
    ) {
        this._extensionPath = extensionPath;
        // Initialize git for each repository
        for (const repoPath of _repositories) {
            this._gitRepos.set(repoPath, simpleGit(repoPath));
        }
    }

    public async resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        console.log('Resolving webview view...');
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = await this._getHtmlForWebview(webviewView.webview);

        // Handle messages from the webview
        webviewView.webview.onDidReceiveMessage(async (data) => {
            console.log('Received message from webview:', data);
            switch (data.type) {
                case 'refresh':
                    await this._updateChanges();
                    break;
                case 'commit':
                    await this._commitChanges(data.message, data.files);
                    break;
            }
        });

        // Initial update
        console.log('Performing initial update...');
        await this._updateChanges();
    }

    private async _updateChanges() {
        if (!this._view) {
            console.log('View not initialized yet');
            return;
        }

        try {
            console.log('Updating changes...');
            const status = await this._getGitStatus();
            console.log('Got git status:', status);

            this._view.webview.postMessage({
                type: 'updateChanges',
                status
            });
            console.log('Posted updateChanges message to webview');
        } catch (error) {
            console.error('Failed to update changes:', error);
            vscode.window.showErrorMessage('Failed to update changes: ' + (error instanceof Error ? error.message : String(error)));
        }
    }

    private async _getGitStatus(): Promise<GitStatus> {
        const repositories: GitStatus['repositories'] = {};

        // Get status for each repository
        for (const [repoPath, git] of this._gitRepos.entries()) {
            try {
                console.log(`Getting status for repo: ${repoPath}`);
                const status = await git.status();
                console.log(`Raw status for ${repoPath}:`, status);
                
                // All versioned files with changes
                const versioned = [
                    ...status.staged,
                    ...status.created,
                    ...status.modified,
                    ...status.renamed.map(f => f.to),
                    ...status.deleted
                ];

                // Files not tracked by git
                const unversioned = [...status.not_added];

                repositories[repoPath] = {
                    versioned: [...new Set(versioned)], // Remove duplicates
                    unversioned
                };
                
                console.log(`Processed status for ${repoPath}:`, repositories[repoPath]);
            } catch (error) {
                console.error(`Error getting status for repo ${repoPath}:`, error);
                repositories[repoPath] = { versioned: [], unversioned: [] };
            }
        }

        console.log('Final git status:', { repositories });
        return { repositories };
    }

    private async _commitChanges(message: string, files: Array<{ path: string, repo: string }>) {
        // Group files by repository
        const filesByRepo = new Map<string, string[]>();
        for (const file of files) {
            const repoFiles = filesByRepo.get(file.repo) || [];
            repoFiles.push(file.path);
            filesByRepo.set(file.repo, repoFiles);
        }

        // Commit in each repository
        const results: Array<{ repo: string, success: boolean, error?: string }> = [];
        
        for (const [repoPath, filesToCommit] of filesByRepo.entries()) {
            const git = this._gitRepos.get(repoPath);
            if (!git) continue;

            try {
                // Stage selected files
                await git.add(filesToCommit);
                // Commit changes
                await git.commit(message);
                results.push({ repo: repoPath, success: true });
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                results.push({ repo: repoPath, success: false, error: errorMessage });
            }
        }

        // Show results
        const successful = results.filter(r => r.success).length;
        const failed = results.filter(r => !r.success).length;

        if (successful > 0) {
            vscode.window.showInformationMessage(
                `Changes committed successfully in ${successful} ${successful === 1 ? 'repository' : 'repositories'}`
            );
        }

        if (failed > 0) {
            const errors = results
                .filter(r => !r.success)
                .map(r => `${path.basename(r.repo)}: ${r.error}`)
                .join('\n');
            vscode.window.showErrorMessage(`Failed to commit in ${failed} ${failed === 1 ? 'repository' : 'repositories'}:\n${errors}`);
        }

        // Refresh the view
        await this._updateChanges();
    }

    private async _getHtmlForWebview(webview: vscode.Webview) {
        const htmlPath = path.join(this._extensionPath, 'src', 'webview', 'commit-view.html');
        const cssPath = path.join(this._extensionPath, 'src', 'webview', 'styles.css');
        const jsPath = path.join(this._extensionPath, 'src', 'webview', 'script.js');

        let html = await fs.promises.readFile(htmlPath, 'utf8');
        const css = await fs.promises.readFile(cssPath, 'utf8');
        const js = await fs.promises.readFile(jsPath, 'utf8');

        // Replace placeholders with actual content
        html = html.replace('/* Content will be replaced with styles.css */', css);
        html = html.replace('/* Content will be replaced with script.js */', js);

        return html;
    }
}

export function activate(context: vscode.ExtensionContext) {
    console.log('Activating iAllAuto extension...');

    // Register commands first
    const showCommitViewCommand = vscode.commands.registerCommand('iallauto.showCommitView', () => {
        vscode.commands.executeCommand('workbench.view.scm');
    });

    const refreshReposCommand = vscode.commands.registerCommand('iallauto.refreshRepositories', async () => {
        try {
            const repos = await findGitRepositories();
            if (repos.length > 0) {
                vscode.window.showInformationMessage(
                    `Found ${repos.length} Git ${repos.length === 1 ? 'repository' : 'repositories'}`
                );
            }
            return repos;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error('Error refreshing repositories:', error);
            vscode.window.showErrorMessage('Failed to refresh repositories: ' + errorMessage);
            return [];
        }
    });

    // Add commands to subscriptions immediately
    context.subscriptions.push(showCommitViewCommand, refreshReposCommand);

    // Initialize repositories and provider
    findGitRepositories().then(repositories => {
        console.log('=== Git Repositories ===');
        console.log(JSON.stringify(repositories, null, 2));
        console.log('=======================');

        if (repositories.length === 0) {
            vscode.window.showWarningMessage(
                'No Git repositories found. Please open a workspace or configure base folders in settings.',
                'Configure Settings'
            ).then(selection => {
                if (selection === 'Configure Settings') {
                    vscode.commands.executeCommand('workbench.action.openSettings', 'iallauto.git');
                }
            });
            return;
        }

        try {
            const provider = new CommitViewProvider(context.extensionPath, context.extensionUri, repositories);
            const providerRegistration = vscode.window.registerWebviewViewProvider('iallAutoCommitView', provider);
            context.subscriptions.push(providerRegistration);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error('Error creating commit view provider:', error);
            vscode.window.showErrorMessage('Failed to initialize commit view: ' + errorMessage);
        }
    }).catch(error => {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error('Error during activation:', error);
        vscode.window.showErrorMessage('Failed to initialize extension: ' + errorMessage);
    });
}

export function deactivate() {}
