import * as vscode from 'vscode';
import * as path from 'path';

export class FileTreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly repo?: string,
        public readonly section?: string,
        public readonly isFile: boolean = false
    ) {
        super(label, collapsibleState);
        
        this.tooltip = this.label;
        this.contextValue = isFile ? 'file' : 'directory';
        this.iconPath = isFile 
            ? new vscode.ThemeIcon('file')
            : new vscode.ThemeIcon('folder');
    }
}

export class FileTreeProvider implements vscode.TreeDataProvider<FileTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<FileTreeItem | undefined | null | void> = new vscode.EventEmitter<FileTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<FileTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    constructor(private workspaceRoot: string) {}

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: FileTreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: FileTreeItem): Thenable<FileTreeItem[]> {
        if (!this.workspaceRoot) {
            vscode.window.showInformationMessage('No files in empty workspace');
            return Promise.resolve([]);
        }

        if (element) {
            // Return children of the directory
            return this.getFilesInDirectory(element);
        } else {
            // Root level - show repositories
            return this.getRepositories();
        }
    }

    private async getRepositories(): Promise<FileTreeItem[]> {
        const gitApi = vscode.extensions.getExtension('vscode.git')?.exports.getAPI(1);
        if (!gitApi) {
            return [];
        }

        return gitApi.repositories.map(repo => {
            return new FileTreeItem(
                path.basename(repo.rootUri.fsPath),
                vscode.TreeItemCollapsibleState.Collapsed,
                repo.rootUri.fsPath
            );
        });
    }

    private async getFilesInDirectory(element: FileTreeItem): Promise<FileTreeItem[]> {
        if (!element.repo) {
            return [];
        }

        const currentPath = element.label;
        const fullPath = path.join(element.repo, currentPath);

        try {
            const files = await vscode.workspace.fs.readDirectory(vscode.Uri.file(fullPath));
            
            return files.map(([name, type]) => {
                const isDirectory = type === vscode.FileType.Directory;
                return new FileTreeItem(
                    name,
                    isDirectory ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
                    element.repo,
                    element.section,
                    !isDirectory
                );
            }).sort((a, b) => {
                // Directories first, then files
                if (a.contextValue === 'directory' && b.contextValue === 'file') return -1;
                if (a.contextValue === 'file' && b.contextValue === 'directory') return 1;
                return a.label.localeCompare(b.label);
            });
        } catch (err) {
            return [];
        }
    }
}
