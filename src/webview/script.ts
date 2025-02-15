// Type declarations
declare const acquireVsCodeApi: () => {
    postMessage: (message: any) => void;
    setState: (state: any) => void;
    getState: () => any;
};

interface VSCode {
    postMessage: (message: any) => void;
}

interface FileTreeNode {
    _files: string[];
    [key: string]: FileTreeNode | string[];
}

type Section = 'tracking' | 'unversioned' | 'staged';

interface FileTreesBySection {
    [repoPath: string]: {
        [section in Section]: FileTreeNode;
    };
}

interface GitStatus {
    repositories: {
        [key: string]: {
            versioned: string[];
            unversioned: string[];
        };
    };
}

interface SectionNode {
    sectionNode: HTMLDivElement;
    childrenDiv: HTMLDivElement;
}

interface CheckboxDataset extends DOMStringMap {
    repo?: string;
    dir?: string;
    file?: string;
    section?: string;
}

interface DirectoryCheckbox extends HTMLInputElement {
    dataset: CheckboxDataset;
}

interface TreeNode extends HTMLElement {
    dataset: {
        repo?: string;
        dir?: string;
        file?: string;
        section?: string;
    };
    style: CSSStyleDeclaration;
    className: string;
    id: string;
    tagName: string;
    classList: DOMTokenList;
    focus(): void;
    scrollIntoView(options?: ScrollIntoViewOptions): void;
    querySelector(selectors: string): Element | null;
    appendChild<T extends Node>(node: T): T;
    addEventListener(type: string, listener: (event: Event) => void): void;
}

type FileKey = `${string}:${Section}:${string}`; // repoPath:section:filePath
type RepoKey = `${string}:${Section}`; // repoPath:section

// Remove Node.js path import and use browser-compatible path handling
function joinPath(...parts: string[]): string {
    return parts.join('/').replace(/\/+/g, '/');
}

const vscode = acquireVsCodeApi();
let currentStatus: GitStatus | null = null;
let currentFilesBySection: { [key: string]: FileTreeNode } = {};
let selectedFiles = new Set<string>();
let expandedNodes = new Set<string>();
let focusedNodeId: string | null = null;
let isTreeView: boolean = true;

// Debug environment flag
const isDebugEnv = window.location.hostname === 'localhost';

function log(message: string, type: 'info' | 'error' | 'success' = 'info', ...args: any[]): void {
    // Ignore messages containing 'hello'
    if (message.toLowerCase().includes('hello')) {
        return;
    }

    // Format message with additional args
    const fullMessage = args?.length > 0 ? `${message} ${args?.map(arg => 
        typeof arg === 'object' ? JSON.stringify(arg) : arg
    ).join(' ')}` : message;
    
    // Log to console
    console.log(`[${type?.toUpperCase()}] ${fullMessage}`);
    
    // Show debug message block if in debug environment
    if (isDebugEnv) {
        const debugContainer = document.getElementById('debug-messages') || (() => {
            const container = document.createElement('div');
            container.id = 'debug-messages';
            container.style.cssText = `
                position: fixed;
                bottom: 0;
                right: 0;
                max-width: 50%;
                max-height: 200px;
                overflow-y: auto;
                background: rgba(0, 0, 0, 0.8);
                color: #fff;
                font-family: monospace;
                font-size: 12px;
                padding: 10px;
                z-index: 9999;
                border-top-left-radius: 4px;
            `;
            document.body.appendChild(container);
            return container;
        })();

        const messageDiv = document.createElement('div');
        messageDiv.style.cssText = `
            padding: 4px 8px;
            margin: 2px 0;
            border-left: 3px solid ${type === 'error' ? '#ff4444' : type === 'success' ? '#44ff44' : '#4444ff'};
            word-wrap: break-word;
        `;
        messageDiv.textContent = `[${new Date().toLocaleTimeString()}] ${fullMessage}`;
        
        debugContainer.appendChild(messageDiv);
        
        // Keep only last 50 messages
        while (debugContainer.children.length > 50) {
            debugContainer.removeChild(debugContainer.firstChild!);
        }

        // Auto-scroll to bottom
        debugContainer.scrollTop = debugContainer.scrollHeight;
    }
}

console.log('Script loaded, initializing...');

// Initialize the view
function initialize() {
    log('Initializing view...');
    // Add status message to show loading state
    const statusDiv = document.getElementById('status-message');
    if (statusDiv) {
        statusDiv.textContent = 'Loading changes...';
        statusDiv.style.color = '#666';
    }
    vscode.postMessage({ type: 'refresh' });
}

// Call initialize when DOM is loaded
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
} else {
    initialize();
}

// Handle messages from the extension
window.addEventListener('message', event => {
    const message = event.data;
    log('Received message: ' + JSON.stringify(message));

    try {
        switch (message.type || message.command) {
            case 'updateChanges':
                log('Received updateChanges message: ' + JSON.stringify(message));
                if (message.status) {
                    currentStatus = message.status;
                    updateView();
                } else {
                    log('No status data in updateChanges message', 'error');
                    const statusDiv = document.getElementById('status-message');
                    if (statusDiv) {
                        statusDiv.textContent = 'Error: Failed to load changes';
                        statusDiv.style.color = 'var(--vscode-errorForeground)';
                    }
                }
                break;
                
            case 'update':
            case 'updateStatus':
                log('Received update/updateStatus message: ' + JSON.stringify(message));
                if (message.status) {
                    currentStatus = message.status;
                    updateView();
                } else {
                    log('No status data in update/updateStatus message', 'error');
                }
                break;
                
            case 'updateFiles':
                log('Received updateFiles message: ' + JSON.stringify(message));
                const { repoPath, files, section } = message;
                if (repoPath && files && section) {
                    const repoKey = getRepoKey(repoPath, section);
                    const fileTree = createFileTree(files);
                    currentFilesBySection[repoKey] = fileTree;
                    updateView();
                }
                break;
                
            case 'commitSuccess':
                log('Changes committed successfully', 'success');
                updateStatusMessage('Changes committed successfully', 'success');
                showPushPrompt();
                const commitInput = document.getElementById('commit-message') as HTMLTextAreaElement;
                if (commitInput) {
                    commitInput.value = '';
                }
                selectedFiles.clear();
                updateView();
                break;
                
            case 'error':
                log('Error: ' + message.error, 'error');
                updateStatusMessage(message.error, 'error');
                break;
                
            default:
                break;
                //log('Unknown message type/command: ' + (message.type || message.command), 'error');
        }
    } catch (error) {
        log('Error handling message: ' + error, 'error');
        const statusDiv = document.getElementById('status-message');
        if (statusDiv) {
            statusDiv.textContent = 'Error: ' + error;
            statusDiv.style.color = 'var(--vscode-errorForeground)';
        }
    }
});

// Call initialize when the document is ready
document.addEventListener('DOMContentLoaded', () => {
    log('DOM loaded, setting up view...');
    
    const root = document.getElementById('tree-root');
    if (!root) {
        log('Could not find tree-root element', 'error');
        return;
    }
    
    // Show loading state
    root.innerHTML = '<div class="empty-message">Loading changes...</div>';
    
    // Initialize the view
    initialize();
    
    // Set up event listeners
    const commitButton = document.getElementById('commit-button');
    if (commitButton) {
        commitButton.addEventListener('click', handleCommit);
    }

    const commitMessage = document.getElementById('commit-message');
    if (commitMessage) {
        commitMessage.addEventListener('input', updateCommitButton);
    }
    
    // Set up keyboard navigation
    document.addEventListener('keydown', (event: KeyboardEvent) => {
        if (!focusedNodeId) {
            const firstNode = getNextVisibleNode(document.querySelector('.tree-node, .section'), 'down');
            if (firstNode) {
                focusNode(firstNode);
                event.preventDefault();
                return;
            }
        }
        handleKeyboardNavigation(event);
    });
});

function updateView(): void {
    log('Updating view with status: ' + JSON.stringify(currentStatus));
    
    const root = document.getElementById('tree-root');
    const statusMessage = document.getElementById('status-message');
    if (!root) {
        log('Could not find tree-root element', 'error');
        return;
    }

    // Clear loading message
    if (statusMessage) {
        statusMessage.textContent = '';
    }

    if (!currentStatus || !currentStatus.repositories) {
        log('No status data available');
        root.innerHTML = '<div class="empty-message">No changes detected</div>';
        return;
    }

    log('Clearing root content');
    root.innerHTML = '';
    currentFilesBySection = {};

    // Process repositories
    const repos = currentStatus.repositories;
    log('Processing repositories: ' + Object.keys(repos).join(', '));

    // Handle versioned files
    const versionedRepos = Object.entries(repos)
        .filter(([_, status]) => status.versioned && status.versioned.length > 0);
    
    if (versionedRepos.length > 0) {
        log('Creating tracking section for repos: ' + versionedRepos.map(([repo]) => repo).join(', '));
        const { sectionNode, childrenDiv } = createSectionNode('tracking', 'Tracking');
        
        versionedRepos.forEach(([repoPath, status]) => {
            const fileTree = createFileTree(status.versioned);
            currentFilesBySection[getRepoKey(repoPath, 'tracking')] = fileTree;
            const repoNode = createRepoNode(repoPath, fileTree, 'tracking');
            childrenDiv.appendChild(repoNode);
        });
        
        root.appendChild(sectionNode);
    }

    // Handle unversioned files
    const unversionedRepos = Object.entries(repos)
        .filter(([_, status]) => status.unversioned && status.unversioned.length > 0);
    
    if (unversionedRepos.length > 0) {
        log('Creating unversioned section for repos: ' + unversionedRepos.map(([repo]) => repo).join(', '));
        const { sectionNode, childrenDiv } = createSectionNode('unversioned', 'Unversioned');
        
        unversionedRepos.forEach(([repoPath, status]) => {
            const fileTree = createFileTree(status.unversioned);
            currentFilesBySection[getRepoKey(repoPath, 'unversioned')] = fileTree;
            const repoNode = createRepoNode(repoPath, fileTree, 'unversioned');
            childrenDiv.appendChild(repoNode);
        });
        
        root.appendChild(sectionNode);
    }

    // If no changes found
    if (root.children.length === 0) {
        log('No changes detected');
        root.innerHTML = '<div class="empty-message">No changes detected</div>';
    }

    // Update section checkbox states
    log('Updating section checkbox states');
    updateSectionCheckboxStates();

    // Restore expanded state
    expandedNodes.forEach(nodeId => {
        const childrenElement = document.getElementById(`children-${nodeId}`);
        const toggleElement = document.getElementById(`toggle-${nodeId}`);
        if (childrenElement && toggleElement) {
            childrenElement.style.display = 'block';
            toggleElement.className = 'tree-toggle codicon codicon-chevron-down';
        }
    });
}

function refreshChanges(): void {
    vscode.postMessage({ type: 'refresh' });
}

function toggleNode(nodeId: string): void {
    log(`Toggling node: ${nodeId}`);
    const childrenElement = document.getElementById(`children-${nodeId}`) as HTMLDivElement | null;
    const toggleElement = document.getElementById(`toggle-${nodeId}`) as HTMLSpanElement | null;
    
    if (childrenElement && toggleElement) {
        const isExpanded = expandedNodes.has(nodeId);
        if (isExpanded) {
            log(`Collapsing node: ${nodeId}`);
            childrenElement.style.display = 'none';
            toggleElement.classList.remove('codicon-chevron-down');
            toggleElement.classList.add('codicon-chevron-right');
            expandedNodes.delete(nodeId);
        } else {
            log(`Expanding node: ${nodeId}`);
            childrenElement.style.display = 'block';
            toggleElement.classList.remove('codicon-chevron-right');
            toggleElement.classList.add('codicon-chevron-down');
            expandedNodes.add(nodeId);
        }
    }
}

function getFileKey(repoPath: string, section: Section, file: string): FileKey {
    return `${repoPath}:${section}:${file}`;
}

function getRepoKey(repoPath: string, section: Section): RepoKey {
    return `${repoPath}:${section}`;
}

function toggleFile(repoPath: string, file: string, section: Section): void {
    log(`[toggleFile] Toggling file: ${file} in repo: ${repoPath}, section: ${section}`);
    
    const sectionDiv = document.querySelector(`.${section}-section`);
    if (!sectionDiv) return;

    const checkbox = sectionDiv.querySelector(`input[type="checkbox"][data-repo="${repoPath}"][data-file="${file}"][data-section="${section}"]`) as HTMLInputElement;
    if (!checkbox) return;

    const isChecked = checkbox.checked;
    const repoKey = getRepoKey(repoPath, section);
    const repoFiles = selectedFiles.has(repoKey);

    if (isChecked) {
        selectedFiles.add(repoKey);
    } else {
        selectedFiles.delete(repoKey);
    }

    const dirPath = file.split('/').slice(0, -1).join('/');
    if (dirPath) {
        updateParentDirectoryCheckboxes(repoPath, dirPath, section);
    }

    updateCommitButton();
}

function updateParentDirectoryCheckboxes(repoPath: string, dirPath: string, section: Section): void {
    // Get all checkboxes for this repo and section
    const allCheckboxes = Array.from(document.querySelectorAll<HTMLInputElement>(
        `input[type="checkbox"][data-repo="${repoPath}"][data-section="${section}"]`
    ));

    // Get all file checkboxes
    const fileCheckboxes = allCheckboxes.filter(cb => cb.dataset.file);
    
    // For each directory level in the path, update its checkbox state
    const pathParts = dirPath.split('/');
    for (let i = 1; i <= pathParts.length; i++) {
        const currentPath = pathParts.slice(0, i).join('/');
        if (!currentPath) continue;

        const dirCheckbox = document.querySelector<HTMLInputElement>(
            `input[type="checkbox"][data-repo="${repoPath}"][data-dir="${currentPath}"][data-section="${section}"]`
        );
        
        if (dirCheckbox) {
            // Get all files under this directory
            const filesUnderDir = fileCheckboxes.filter(cb => {
                const filePath = cb.dataset.file;
                return filePath && (
                    filePath === currentPath || // Exact match
                    filePath.startsWith(currentPath + '/') // Under this directory
                );
            });

            if (filesUnderDir.length > 0) {
                const allChecked = filesUnderDir.every(cb => cb.checked);
                const someChecked = filesUnderDir.some(cb => cb.checked);
                
                dirCheckbox.checked = allChecked;
                dirCheckbox.indeterminate = !allChecked && someChecked;
            }
        }
    }
    
    // Update section checkbox state
    updateSectionCheckboxStates();
}

function updateSectionCheckboxState(sectionId: Section): void {
    log(`[updateSectionCheckboxState] Updating section: ${sectionId}`);
    const section = document.getElementById(sectionId);
    const sectionCheckbox = document.getElementById(`${sectionId}-checkbox`) as HTMLInputElement;
    if (!section || !sectionCheckbox) {
        log('[updateSectionCheckboxState] Section or checkbox not found');
        return;
    }

    let allChecked = true;
    let allUnchecked = true;

    for (const [repoPath, sections] of Object.entries(currentFilesBySection)) {
        const fileTree = sections[sectionId];
        if (!fileTree) continue;

        const allFiles = getAllFilesUnderTree(fileTree);
        log(`[updateSectionCheckboxState] Files in repo ${repoPath}`, 'info', allFiles);

        for (const file of allFiles) {
            const isSelected = selectedFiles.has(getFileKey(repoPath, sectionId, file));
            if (isSelected) {
                allUnchecked = false;
            } else {
                allChecked = false;
            }
            if (!allChecked && !allUnchecked) break;
        }
        if (!allChecked && !allUnchecked) break;
    }

    log(`[updateSectionCheckboxState] allChecked: ${allChecked}, allUnchecked: ${allUnchecked}`);
    sectionCheckbox.checked = allChecked;
    sectionCheckbox.indeterminate = !allChecked && !allUnchecked;
}

function toggleSection(sectionId: Section, isChecked: boolean): void {
    const section = document.getElementById(sectionId);
    if (!section) return;

    const fileCheckboxes = section.querySelectorAll('input[type="checkbox"][data-repo]') as NodeListOf<HTMLInputElement>;
    
    const processedRepos = new Set<string>();
    fileCheckboxes.forEach(checkbox => {
        const repoPath = checkbox.dataset.repo;
        
        if (repoPath && !processedRepos.has(repoPath)) {
            processedRepos.add(repoPath);
            const fileTree = currentFilesBySection[getRepoKey(repoPath, sectionId)];
            if (fileTree) {
                const allFiles = getAllFilesUnderTree(fileTree);
                allFiles.forEach(file => {
                    if (isChecked) {
                        selectedFiles.add(getFileKey(repoPath, sectionId, file));
                    } else {
                        selectedFiles.delete(getFileKey(repoPath, sectionId, file));
                    }
                });
            }
        }
    });

    const sectionCheckbox = document.getElementById(`${sectionId}-checkbox`) as HTMLInputElement;
    if (sectionCheckbox) {
        sectionCheckbox.checked = isChecked;
        sectionCheckbox.indeterminate = false;
    }

    updateSectionCheckboxStates();
    updateView();
}

function createSectionNode(sectionId: Section, title: string): SectionNode {
    log('Creating section node', 'info', sectionId, title);
    const sectionNode = document.createElement('div') as HTMLDivElement;
    sectionNode.className = `section ${sectionId}-section`;
    sectionNode.id = sectionId;
    sectionNode.dataset.section = sectionId;

    const titleDiv = document.createElement('div');
    titleDiv.className = 'section-title';

    const toggleSpan = document.createElement('span');
    toggleSpan.className = 'codicon codicon-chevron-down';
    titleDiv.appendChild(toggleSpan);

    const checkbox = document.createElement('input') as HTMLInputElement;
    checkbox.type = 'checkbox';
    checkbox.className = 'section-checkbox';
    checkbox.id = `${sectionId}-checkbox`;
    checkbox.dataset.section = sectionId;
    checkbox.addEventListener('change', () => toggleSection(sectionId, checkbox.checked));
    titleDiv.appendChild(checkbox);

    const titleSpan = document.createElement('span');
    titleSpan.textContent = title;
    titleDiv.appendChild(titleSpan);

    sectionNode.appendChild(titleDiv);

    const childrenDiv = document.createElement('div') as HTMLDivElement;
    childrenDiv.className = 'section-content';
    sectionNode.appendChild(childrenDiv);

    log('Created section node', 'info', sectionNode);
    return { sectionNode, childrenDiv };
}

/*function toggleSection(section: Section, checked: boolean): void {
    log(`Toggling section ${section} to ${checked}`);
    
    // Get all repo checkboxes for this section
    const repoCheckboxes = document.querySelectorAll<HTMLInputElement>(
        `input[type="checkbox"][data-section="${section}"]:not([data-dir]):not([data-file])`
    );
    
    // Update each repo
    repoCheckboxes.forEach(checkbox => {
        const repoPath = checkbox.dataset.repo;
        if (repoPath) {
            toggleRepoFiles(repoPath, checked, section);
        }
    });
    
    // Update the section checkbox
    const sectionCheckbox = document.querySelector<HTMLInputElement>(
        `input[type="checkbox"].section-checkbox[data-section="${section}"]`
    );
    
    if (sectionCheckbox) {
        sectionCheckbox.checked = checked;
        sectionCheckbox.indeterminate = false;
    }
    
    // Update commit button state
    updateCommitButton();
}
*/

function toggleDirectoryFiles(repoPath: string, dirPath: string, checked: boolean, section: Section): void {
    log(`Toggling directory ${dirPath} in repo ${repoPath} to ${checked}`);
    
    // Get all checkboxes under this directory
    const dirSelector = `[data-repo="${repoPath}"][data-section="${section}"]`;
    const allCheckboxes = document.querySelectorAll<HTMLInputElement>(`input[type="checkbox"]${dirSelector}`);
    
    // First update all immediate children
    allCheckboxes.forEach(checkbox => {
        const checkboxDir = checkbox.dataset.dir;
        const checkboxFile = checkbox.dataset.file;
        
        if (checkboxDir === dirPath) {
            // This is the directory checkbox itself
            checkbox.checked = checked;
            checkbox.indeterminate = false;
        } else if (checkboxFile && checkboxFile.startsWith(dirPath + '/') && 
                  !checkboxFile.slice(dirPath.length + 1).includes('/')) {
            // This is an immediate file child
            checkbox.checked = checked;
            if (checked) {
                selectFile(repoPath, checkboxFile, section);
            } else {
                unselectFile(repoPath, checkboxFile, section);
            }
        } else if (checkboxDir && checkboxDir.startsWith(dirPath + '/') && 
                  !checkboxDir.slice(dirPath.length + 1).includes('/')) {
            // This is an immediate directory child
            checkbox.checked = checked;
            checkbox.indeterminate = false;
            // Recursively update this directory's children
            toggleDirectoryFiles(repoPath, checkboxDir, checked, section);
        }
    });
    
    // Update parent directory states
    let parentPath = dirPath.split('/').slice(0, -1).join('/');
    while (parentPath) {
        const parentCheckbox = document.querySelector<HTMLInputElement>(
            `input[type="checkbox"][data-repo="${repoPath}"][data-dir="${parentPath}"][data-section="${section}"]`
        );
        
        if (parentCheckbox) {
            // Get all immediate children of this parent
            const immediateChildren = Array.from(allCheckboxes).filter(checkbox => {
                const childDir = checkbox.dataset.dir;
                const childFile = checkbox.dataset.file;
                const path = childDir || childFile;
                
                if (!path) return false;
                
                // Check if it's an immediate child
                const relativePath = path.slice(parentPath.length + 1);
                return path.startsWith(parentPath + '/') && !relativePath.includes('/');
            });
            
            // Check children states
            const allChecked = immediateChildren.every(c => c.checked);
            const allUnchecked = immediateChildren.every(c => !c.checked && !c.indeterminate);
            
            if (allChecked) {
                parentCheckbox.checked = true;
                parentCheckbox.indeterminate = false;
            } else if (allUnchecked) {
                parentCheckbox.checked = false;
                parentCheckbox.indeterminate = false;
            } else {
                parentCheckbox.checked = false;
                parentCheckbox.indeterminate = true;
            }
        }
        
        parentPath = parentPath.split('/').slice(0, -1).join('/');
    }
    
    // Update section checkbox state
    updateSectionCheckboxStates();
    
    // Update commit button state
    updateCommitButton();
}

function createFileTree(files: string[]): FileTreeNode {
    const tree: FileTreeNode = { _files: [] };
    
    files.forEach(file => {
        const parts = file.split('/');
        let currentNode: FileTreeNode = tree;
        let currentPath = '';
        
        // Handle each directory in the path
        for (let i = 0; i < parts.length - 1; i++) {
            const part = parts[i];
            if (!part) continue;
            
            currentPath = currentPath ? `${currentPath}/${part}` : part;
            
            if (!(part in currentNode)) {
                currentNode[part] = { _files: [] };
            }
            currentNode = currentNode[part] as FileTreeNode;
        }
        
        // Add the file to the final directory's _files array
        const fileName = parts[parts.length - 1];
        if (fileName) {
            currentNode._files.push(file); // Store full path
        }
    });
    
    return tree;
}

function createRepoNode(repoPath: string, fileTree: FileTreeNode, section: Section): TreeNode {
    log(`Creating repo node for ${repoPath} in section ${section}`);
    
    const repoNode = document.createElement('div') as TreeNode;
    repoNode.className = 'tree-node repo-node';
    repoNode.dataset.repo = repoPath;
    repoNode.dataset.section = section;

    const contentDiv = document.createElement('div');
    contentDiv.className = 'tree-content';

    const toggleSpan = document.createElement('span');
    toggleSpan.className = 'tree-toggle codicon codicon-chevron-right';
    contentDiv.appendChild(toggleSpan);

    const checkbox = document.createElement('input') as HTMLInputElement;
    checkbox.type = 'checkbox';
    checkbox.className = 'tree-checkbox';
    checkbox.dataset.repo = repoPath;
    checkbox.dataset.section = section;
    checkbox.addEventListener('change', () => toggleRepoFiles(repoPath, checkbox.checked, section));
    contentDiv.appendChild(checkbox);

    const iconSpan = document.createElement('span');
    iconSpan.className = 'codicon codicon-git-branch';
    contentDiv.appendChild(iconSpan);

    const label = document.createElement('span');
    label.className = 'tree-label';
    label.textContent = repoPath.split('/').pop() || repoPath; // Show only the repo name
    contentDiv.appendChild(label);

    repoNode.appendChild(contentDiv);

    const childrenDiv = document.createElement('div');
    childrenDiv.className = 'tree-children';
    repoNode.appendChild(childrenDiv);

    // Add click handler to toggle children
    contentDiv.addEventListener('click', (e) => {
        if (e.target === checkbox) return; // Don't toggle on checkbox click
        childrenDiv.classList.toggle('expanded');
        toggleSpan.classList.toggle('codicon-chevron-right');
        toggleSpan.classList.toggle('codicon-chevron-down');
    });

    // Create root level file nodes
    const rootFiles = fileTree._files || [];
    rootFiles.forEach(file => {
        if (!file.includes('/')) {
            childrenDiv.appendChild(createFileNode(repoPath, file, section));
        }
    });

    // Create directory nodes
    Object.entries(fileTree)
        .filter(([key]) => key !== '_files')
        .forEach(([key, value]) => {
            childrenDiv.appendChild(
                createDirectoryNode(repoPath, key, value as FileTreeNode, section)
            );
        });

    return repoNode;
}

function toggleAllFiles(repoPath: string, section: Section): void {
    const repoKey = getRepoKey(repoPath, section);
    const fileTree = currentFilesBySection[repoKey];
    if (!fileTree) return;

    const allFiles = getAllFilesUnderTree(fileTree);
    const allSelected = allFiles.every(file => selectedFiles.has(getFileKey(repoPath, section, file)));

    allFiles.forEach(file => {
        if (allSelected) {
            selectedFiles.delete(getFileKey(repoPath, section, file));
        } else {
            selectedFiles.add(getFileKey(repoPath, section, file));
        }
    });

    updateView();
}

function getAllFilesUnderTree(tree: FileTreeNode | string[]): string[] {
    if (Array.isArray(tree)) {
        return tree;
    }
    
    if (!tree || typeof tree !== 'object') {
        return [];
    }
    
    let files: string[] = [];
    
    // Add files from current directory
    if (Array.isArray(tree._files)) {
        files.push(...tree._files);
    }
    
    // Add files from subdirectories
    Object.entries(tree).forEach(([key, subtree]) => {
        if (key !== '_files' && typeof subtree === 'object') {
            const subFiles = getAllFilesUnderTree(subtree);
            files.push(...subFiles);
        }
    });
    
    return files;
}

function getSubtreeFromPath(tree: FileTreeNode, path: string): FileTreeNode | null {
    if (!path) return tree;
    
    const parts = path.split('/');
    let current: FileTreeNode | null = tree;
    
    for (const part of parts) {
        if (!current || !current[part] || Array.isArray(current[part])) return null;
        current = current[part] as FileTreeNode;
    }
    
    return current;
}

function updateCommitButton(): void {
    const commitButton = document.getElementById('commit-button') as HTMLButtonElement;
    const commitMessage = document.getElementById('commit-message') as HTMLTextAreaElement;
    
    log('[updateCommitButton] Selected files', 'info', Array.from(selectedFiles));

    if (!commitButton || !commitMessage) return;

    const hasMessage = commitMessage.value.trim().length > 0;
    const hasFiles = selectedFiles.size > 0;

    commitButton.disabled = !hasMessage || !hasFiles;
}

function getSelectedPaths(): Array<{ path: string, repo: string }> {
    log('[getSelectedPaths] Getting selected paths...');
    
    const selectedPaths: Array<{ path: string, repo: string }> = [];
    selectedFiles.forEach(fileKey => {
        const [repoPath, section, filePath] = fileKey.split(':');
        log(`[getSelectedPaths] Adding file: ${filePath} from repo: ${repoPath}`);
        selectedPaths.push({
            path: filePath,
            repo: repoPath
        });
    });
    log('[getSelectedPaths] Final selected paths', 'info', selectedPaths);
    return selectedPaths;
}

function handleCommit(): void {
    log('[handleCommit] Starting commit...');
    const commitMessage = (document.getElementById('commit-message') as HTMLTextAreaElement).value;
    log('[handleCommit] Commit message', 'info', commitMessage);

    const selectedPaths: Array<{ path: string, repo: string, section: Section }> = [];
    selectedFiles.forEach(fileKey => {
        const [repoPath, section, filePath] = fileKey.split(':') as [string, Section, string];
        selectedPaths.push({ path: filePath, repo: repoPath, section });
    });

    if (!commitMessage) {
        log('[handleCommit] No commit message provided', 'error');
        updateStatusMessage('Please enter a commit message', 'error');
        return;
    }

    if (selectedPaths.length === 0) {
        log('[handleCommit] No files selected', 'error');
        updateStatusMessage('Please select files to commit', 'error');
        return;
    }

    log('[handleCommit] Sending commit message to VS Code');
    log('[handleCommit] Selected paths', 'info', selectedPaths);
    vscode.postMessage({
        command: 'commit',
        message: commitMessage,
        files: selectedPaths
    });
}

function toggleNodeSelection(nodeId: string): void {
    const node = document.getElementById(nodeId);
    if (!node) return;

    const checkbox = node.querySelector('input[type="checkbox"]') as HTMLInputElement;
    if (checkbox) {
        checkbox.checked = !checkbox.checked;
        checkbox.dispatchEvent(new Event('change'));
    }
}

function getNextVisibleNode(currentNode: TreeNode | null, direction: 'up' | 'down'): TreeNode | null {
    if (!currentNode) return null;

    if (direction === 'down') {
        // First try to find the first child
        const childrenDiv = currentNode.querySelector('.section-children') as TreeNode;
        if (childrenDiv && childrenDiv.style.display !== 'none') {
            const firstChild = childrenDiv.querySelector('.tree-node, .section') as TreeNode;
            if (firstChild) return firstChild;
        }

        // If no child found, try to find the next sibling
        let nextNode: TreeNode | null = currentNode;
        while (nextNode) {
            const nextSibling = nextNode.nextElementSibling as TreeNode;
            if (nextSibling) return nextSibling;

            // If no sibling found, move up to parent and try again
            const parentElement = nextNode.parentElement?.closest('.tree-node, .section') as TreeNode;
            if (!parentElement) return null;
            nextNode = parentElement;
        }
    } else {
        // First try to find the previous sibling's last visible child
        const prevSibling = currentNode.previousElementSibling as TreeNode;
        if (prevSibling) {
            const childrenDiv = prevSibling.querySelector('.section-children') as TreeNode;
            if (childrenDiv && childrenDiv.style.display !== 'none') {
                const lastChild = Array.from(childrenDiv.querySelectorAll('.tree-node')).pop() as TreeNode;
                if (lastChild) return lastChild;
            }
            return prevSibling;
        }

        // If no previous sibling, return the parent
        return currentNode.parentElement?.closest('.tree-node, .section') as TreeNode;
    }

    return null;
}

function focusNode(node: TreeNode): void {
    if (focusedNodeId) {
        const prevNode = document.getElementById(focusedNodeId);
        if (prevNode) {
            prevNode.blur();
        }
    }

    focusedNodeId = node.id;
    node.focus();
    node.scrollIntoView({ block: 'nearest' });
}

function handleKeyboardNavigation(event: KeyboardEvent): void {
    const currentNode = focusedNodeId ? document.getElementById(focusedNodeId) : null;
    let nextNode: TreeNode | null = null;

    switch (event.key) {
        case 'ArrowUp':
            if (currentNode) {
                event.preventDefault();
                nextNode = getNextVisibleNode(currentNode as TreeNode, 'up');
            }
            break;

        case 'ArrowDown':
            if (currentNode) {
                event.preventDefault();
                nextNode = getNextVisibleNode(currentNode as TreeNode, 'down');
            }
            break;

        case 'ArrowRight':
            if (currentNode) {
                event.preventDefault();
                if (currentNode.classList.contains('section')) {
                    const childrenDiv = currentNode.querySelector('.section-children') as TreeNode;
                    if (childrenDiv && childrenDiv.style.display === 'none') {
                        childrenDiv.style.display = 'block';
                        const firstChild = childrenDiv.querySelector('.tree-node, .section');
                        if (isTreeNode(firstChild)) {
                            nextNode = firstChild;
                        }
                    }
                } else {
                    if (!currentNode.classList.contains('expanded')) {
                        toggleNode(currentNode.id);
                        const childrenDiv = document.getElementById(`children-${currentNode.id}`);
                        if (childrenDiv) {
                            const firstChild = childrenDiv.querySelector('.tree-node');
                            if (isTreeNode(firstChild)) {
                                nextNode = firstChild;
                            }
                        }
                    }
                }
            }
            break;

        case 'ArrowLeft':
            if (currentNode) {
                event.preventDefault();
                if (currentNode.classList.contains('section')) {
                    const childrenDiv = currentNode.querySelector('.section-children') as TreeNode;
                    if (childrenDiv && childrenDiv.style.display === 'block') {
                        childrenDiv.style.display = 'none';
                    }
                } else {
                    if (currentNode.classList.contains('expanded')) {
                        toggleNode(currentNode.id);
                    } else {
                        const parent = currentNode.parentElement;
                        if (parent) {
                            const parentElement = parent.closest('.tree-node, .section');
                            if (isTreeNode(parentElement)) {
                                nextNode = parentElement;
                            }
                        }
                    }
                }
            }
            break;

        case ' ':
        case 'Enter':
            if (currentNode) {
                event.preventDefault();
                const section = currentNode.closest('.tracked-section, .untracked-section, .staged-section');
                if (isTreeNode(section)) {
                    const checkbox = currentNode.querySelector('input[type="checkbox"]') as HTMLInputElement;
                    if (checkbox) {
                        checkbox.checked = !checkbox.checked;
                        checkbox.dispatchEvent(new Event('change'));
                    }
                }
            }
            break;
    }

    if (nextNode) {
        focusNode(nextNode);
    }
}

function isTreeNode(element: Element | null): element is TreeNode {
    return element !== null && element.classList.contains('tree-node');
}

function addClickHandler(node: TreeNode) {
    const contentDiv = node.querySelector('.tree-content, .section-title') as TreeNode;
    if (contentDiv) {
        contentDiv.addEventListener('click', (event) => {
            const target = event.target as TreeNode;
            if (target.tagName === 'INPUT' || target.classList.contains('tree-toggle')) {
                return;
            }

            event.stopPropagation();

            focusedNodeId = node.id;
            node.focus();
            node.scrollIntoView({ block: 'nearest' });
        });
    }
}

function selectFile(repoPath: string, file: string, section: Section): void {
    const fileKey = getFileKey(repoPath, section, file);
    selectedFiles.add(fileKey);
}

function unselectFile(repoPath: string, file: string, section: Section): void {
    const fileKey = getFileKey(repoPath, section, file);
    selectedFiles.delete(fileKey);
}

function isFileSelected(repoPath: string, file: string, section: Section): boolean {
    const fileKey = getFileKey(repoPath, section, file);
    return selectedFiles.has(fileKey);
}

function updateRepoCheckbox(repoPath: string, section: Section): void {
    log(`[updateRepoCheckbox] Updating repo checkbox for ${repoPath}, section: ${section}`);
    
    const sectionDiv = document.querySelector(`.${section}-section`);
    if (!sectionDiv) return;

    const checkbox = sectionDiv.querySelector(`input[type="checkbox"][data-repo="${repoPath}"][data-section="${section}"]`) as HTMLInputElement;
    if (!checkbox) return;

    const fileTree = currentFilesBySection[getRepoKey(repoPath, section)];
    if (!fileTree) {
        log(`[updateRepoCheckbox] No file tree found for repo`);
        return;
    }

    const allFiles = getAllFilesUnderTree(fileTree);
    log(`[updateRepoCheckbox] All files`, 'info', allFiles);

    const allSelected = allFiles.every(file => isFileSelected(repoPath, file, section));
    const someSelected = allFiles.some(file => isFileSelected(repoPath, file, section));

    log(`[updateRepoCheckbox] Files status - all: ${allSelected}, some: ${someSelected}`);
    checkbox.checked = allSelected;
    checkbox.indeterminate = !allSelected && someSelected;
}

function showPushPrompt(): void {
    const pushPrompt = document.createElement('div');
    pushPrompt.className = 'push-prompt';
    pushPrompt.innerHTML = `
        <div class="push-prompt-content">
            <p>Would you like to push your changes?</p>
            <div class="push-prompt-buttons">
                <button id="push-yes" class="push-button">Yes</button>
                <button id="push-no" class="push-button">No</button>
            </div>
        </div>
    `;
    document.body.appendChild(pushPrompt);

    document.getElementById('push-yes')?.addEventListener('click', () => {
        vscode.postMessage({ command: 'push' });
        pushPrompt.remove();
    });

    document.getElementById('push-no')?.addEventListener('click', () => {
        pushPrompt.remove();
    });
}

function updateStatusMessage(message: string, type: 'success' | 'error' = 'success'): void {
    let statusArea = document.getElementById('status-message');
    if (!statusArea) {
        statusArea = document.createElement('div');
        statusArea.id = 'status-message';
        const commitButton = document.getElementById('commit-button');
        if (commitButton) {
            commitButton.insertAdjacentElement('afterend', statusArea);
        }
    }
    
    statusArea.textContent = message;
    statusArea.className = `status-message ${type}`;
    
    if (type === 'success') {
        setTimeout(() => {
            if (statusArea) {
                statusArea.textContent = '';
                statusArea.className = 'status-message';
            }
        }, 5000);
    }
}

function createDirectoryNode(repoPath: string, dirPath: string, fileTree: FileTreeNode, section: Section): TreeNode {
    const dirNode = document.createElement('div') as TreeNode;
    dirNode.className = 'tree-node directory-node';
    dirNode.dataset.repo = repoPath;
    dirNode.dataset.dir = dirPath;
    dirNode.dataset.section = section;

    const contentDiv = document.createElement('div');
    contentDiv.className = 'tree-content';

    const toggleSpan = document.createElement('span');
    toggleSpan.className = 'tree-toggle codicon codicon-chevron-right';
    contentDiv.appendChild(toggleSpan);

    const checkbox = document.createElement('input') as HTMLInputElement;
    checkbox.type = 'checkbox';
    checkbox.className = 'tree-checkbox';
    checkbox.dataset.repo = repoPath;
    checkbox.dataset.dir = dirPath;
    checkbox.dataset.section = section;
    checkbox.addEventListener('change', () => {
        toggleDirectoryFiles(repoPath, dirPath, checkbox.checked, section);
        updateParentDirectoryCheckboxes(repoPath, dirPath, section);
        updateRepoCheckbox(repoPath, section);
        //updateSectionCheckboxStates();
        updateCommitButton();
    });
    contentDiv.appendChild(checkbox);

    const iconSpan = document.createElement('span');
    iconSpan.className = 'codicon codicon-folder';
    contentDiv.appendChild(iconSpan);

    const label = document.createElement('span');
    label.className = 'tree-label';
    label.textContent = dirPath.split('/').pop() || '';
    contentDiv.appendChild(label);

    dirNode.appendChild(contentDiv);

    const childrenDiv = document.createElement('div');
    childrenDiv.className = 'tree-children';
    dirNode.appendChild(childrenDiv);

    // Add click handler to toggle children
    contentDiv.addEventListener('click', (e) => {
        if (e.target === checkbox) return;
        childrenDiv.classList.toggle('expanded');
        toggleSpan.classList.toggle('codicon-chevron-right');
        toggleSpan.classList.toggle('codicon-chevron-down');
    });

    // Create file nodes for files in this directory
    const filesInDir = fileTree._files || [];
    filesInDir.forEach(file => {
        if (file) {
            childrenDiv.appendChild(createFileNode(repoPath, file, section));
        }
    });

    // Create directory nodes for subdirectories
    Object.entries(fileTree)
        .filter(([key]) => key !== '_files')
        .forEach(([key, value]) => {
            const fullPath = `${dirPath}/${key}`;
            childrenDiv.appendChild(
                createDirectoryNode(repoPath, fullPath, value as FileTreeNode, section)
            );
        });

    return dirNode;
}

function createFileNode(repoPath: string, file: string, section: Section): TreeNode {
    log(`Creating file node for ${file} in repo ${repoPath}`);
    
    const fileNode = document.createElement('div') as TreeNode;
    fileNode.className = 'tree-node file-node';
    fileNode.dataset.repo = repoPath;
    fileNode.dataset.file = file;
    fileNode.dataset.section = section;

    const contentDiv = document.createElement('div');
    contentDiv.className = 'tree-content';

    const checkbox = document.createElement('input') as HTMLInputElement;
    checkbox.type = 'checkbox';
    checkbox.className = 'tree-checkbox';
    checkbox.dataset.repo = repoPath;
    checkbox.dataset.file = file;
    checkbox.dataset.section = section;
    checkbox.checked = isFileSelected(repoPath, file, section);
    checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
            selectFile(repoPath, file, section);
        } else {
            unselectFile(repoPath, file, section);
        }
        const parentDir = file.split('/').slice(0, -1).join('/');
        if (parentDir) {
            updateParentDirectoryCheckboxes(repoPath, parentDir, section);
        }
        updateSectionCheckboxStates();
        updateRepoCheckbox(repoPath, section);
        updateCommitButton();
    });
    contentDiv.appendChild(checkbox);

    const iconSpan = document.createElement('span');
    iconSpan.className = 'codicon codicon-file';
    contentDiv.appendChild(iconSpan);

    const label = document.createElement('span');
    label.className = 'tree-label';
    label.textContent = file;
    contentDiv.appendChild(label);

    fileNode.appendChild(contentDiv);
    return fileNode;
}

function toggleRepoFiles(repoPath: string, checked: boolean, section: Section): void {
    log(`Toggling repo ${repoPath} to ${checked}`);
    
    // Get all checkboxes for this repo and section
    const repoSelector = `[data-repo="${repoPath}"][data-section="${section}"]`;
    const allCheckboxes = document.querySelectorAll<HTMLInputElement>(`input[type="checkbox"]${repoSelector}`);
    
    // First update all top-level items
    allCheckboxes.forEach(checkbox => {
        const checkboxDir = checkbox.dataset.dir;
        const checkboxFile = checkbox.dataset.file;
        
        // Skip the repo checkbox itself
        if (!checkboxDir && !checkboxFile) return;
        
        // If it's a top-level item (no slashes in path)
        if ((checkboxDir && !checkboxDir.includes('/')) || 
            (checkboxFile && !checkboxFile.includes('/'))) {
            checkbox.checked = checked;
            checkbox.indeterminate = false;
            
            if (checkboxDir) {
                // Recursively update directory children
                toggleDirectoryFiles(repoPath, checkboxDir, checked, section);
            } else if (checkboxFile) {
                // Update file selection
                if (checked) {
                    selectFile(repoPath, checkboxFile, section);
                } else {
                    unselectFile(repoPath, checkboxFile, section);
                }
            }
        }
    });
    
    // Update the repo checkbox state
    const repoCheckbox = document.querySelector<HTMLInputElement>(
        `input[type="checkbox"]${repoSelector}:not([data-dir]):not([data-file])`
    );
    
    if (repoCheckbox) {
        repoCheckbox.checked = checked;
        repoCheckbox.indeterminate = false;
    }
    
    // Update section checkbox state
    updateSectionCheckboxStates();

//    updateRepoCheckbox(repoPath, section);
    
    // Update commit button state
    updateCommitButton();
}

function updateSectionCheckboxStates(): void {
    const sections: Section[] = ['tracking', 'unversioned'];
    
    sections.forEach(section => {
        const sectionCheckbox = document.querySelector<HTMLInputElement>(
            `input[type="checkbox"].section-checkbox[data-section="${section}"]`
        );
        
        if (sectionCheckbox) {
            const repoCheckboxes = document.querySelectorAll<HTMLInputElement>(
                `input[type="checkbox"][data-section="${section}"]:not([data-dir]):not([data-file])`
            );
            
            if (repoCheckboxes.length > 0) {
                const allChecked = Array.from(repoCheckboxes).every(cb => cb.checked);
                const allUnchecked = Array.from(repoCheckboxes).every(cb => !cb.checked && !cb.indeterminate);
                
                if (allChecked) {
                    sectionCheckbox.checked = true;
                    sectionCheckbox.indeterminate = false;
                } else if (allUnchecked) {
                    sectionCheckbox.checked = false;
                    sectionCheckbox.indeterminate = false;
                } else {
                    sectionCheckbox.checked = false;
                    sectionCheckbox.indeterminate = true;
                }
            }
        }
    });
}