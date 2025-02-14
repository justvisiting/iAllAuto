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

type Section = 'tracking' | 'unversioned';

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

interface HTMLElement {
    dataset: {
        repo: string;
        dir: string;
        file: string;
    };
}

const vscode: VSCode = acquireVsCodeApi();
let currentStatus: GitStatus | null = null;
let selectedFiles: Map<string, Set<string>> = new Map();
let currentFilesBySection: FileTreesBySection = {};
let expandedNodes: Set<string> = new Set();
let focusedNodeId: string | null = null;
let isTreeView: boolean = true;

function refreshChanges(): void {
    vscode.postMessage({ type: 'refresh' });
}

function toggleNode(nodeId: string): void {
    console.log(`Toggling node: ${nodeId}`);
    const childrenElement = document.getElementById(`children-${nodeId}`) as HTMLDivElement | null;
    const toggleElement = document.getElementById(`toggle-${nodeId}`) as HTMLSpanElement | null;
    
    if (childrenElement && toggleElement) {
        const isExpanded = expandedNodes.has(nodeId);
        if (isExpanded) {
            console.log(`Collapsing node: ${nodeId}`);
            childrenElement.style.display = 'none';
            toggleElement.classList.remove('codicon-chevron-down');
            toggleElement.classList.add('codicon-chevron-right');
            expandedNodes.delete(nodeId);
        } else {
            console.log(`Expanding node: ${nodeId}`);
            childrenElement.style.display = 'block';
            toggleElement.classList.remove('codicon-chevron-right');
            toggleElement.classList.add('codicon-chevron-down');
            expandedNodes.add(nodeId);
        }
    }
}

function toggleFile(repoPath: string, file: string): void {
    console.log(`[toggleFile] Toggling file: ${file} in repo: ${repoPath}`);
    let repoFiles = selectedFiles.get(repoPath);
    if (!repoFiles) {
        console.log(`[toggleFile] Creating new Set for repo: ${repoPath}`);
        repoFiles = new Set();
        selectedFiles.set(repoPath, repoFiles);
    }

    if (repoFiles.has(file)) {
        console.log(`[toggleFile] Unselecting file: ${file}`);
        repoFiles.delete(file);
    } else {
        console.log(`[toggleFile] Selecting file: ${file}`);
        repoFiles.add(file);
    }

    // Log selected files
    console.log('[toggleFile] Current selectedFiles Map:', Array.from(selectedFiles.entries()).map(([repo, files]) => ({
        repo,
        files: Array.from(files)
    })));

    // Update section checkbox state
    const section = file.startsWith('.') ? 'unversioned' : 'tracking';
    updateSectionCheckboxState(section);

    // Update commit button state
    updateCommitButton();
}

function updateSectionCheckboxState(sectionId: Section): void {
    const checkbox = document.querySelector(`#toggle-${sectionId}`)?.nextElementSibling as HTMLInputElement | null;
    const section = document.getElementById(`children-${sectionId}`);
    if (!section || !checkbox) return;
    
    const fileCheckboxes = Array.from(section.querySelectorAll('.file-node input[type="checkbox"]')) as HTMLInputElement[];
    
    if (fileCheckboxes.length === 0) {
        console.log('No files found in section');
        checkbox.checked = false;
        checkbox.indeterminate = false;
        return;
    }

    const checkedCount = fileCheckboxes.filter(box => box.checked).length;
    console.log(`Files in section: total=${fileCheckboxes.length}, checked=${checkedCount}`);

    if (checkedCount === 0) {
        console.log('No files selected');
        checkbox.checked = false;
        checkbox.indeterminate = false;
    } else if (checkedCount === fileCheckboxes.length) {
        console.log('All files selected');
        checkbox.checked = true;
        checkbox.indeterminate = false;
    } else {
        console.log('Some files selected');
        checkbox.checked = false;
        checkbox.indeterminate = true;
    }
}

function toggleSection(sectionId: Section, isChecked: boolean): void {
    const section = document.getElementById(sectionId);
    if (!section) return;

    // Get all repo checkboxes in this section
    const fileCheckboxes = section.querySelectorAll('input[type="checkbox"][data-repo]') as NodeListOf<HTMLInputElement>;
    
    // Toggle all files in each repo
    const processedRepos = new Set<string>();
    fileCheckboxes.forEach(checkbox => {
        const repoPath = checkbox.dataset.repo;
        
        if (repoPath && !processedRepos.has(repoPath)) {
            processedRepos.add(repoPath);
            const fileTree = currentFilesBySection[repoPath]?.[sectionId];
            if (fileTree) {
                const allFiles = getAllFilesUnderTree(fileTree);
                allFiles.forEach(file => {
                    if (isChecked) {
                        selectFile(repoPath, file);
                    } else {
                        unselectFile(repoPath, file);
                    }
                });
            }
        }
    });

    // Update the section checkbox state
    const sectionCheckbox = document.getElementById(`${sectionId}-checkbox`) as HTMLInputElement;
    if (sectionCheckbox) {
        sectionCheckbox.checked = isChecked;
        sectionCheckbox.indeterminate = false;
    }

    updateView();
}

function createSectionNode(sectionId: Section, title: string): SectionNode {
    const sectionNode = document.createElement('div');
    sectionNode.className = 'section';
    sectionNode.id = sectionId;
    sectionNode.tabIndex = 0; // Make section focusable

    const titleDiv = document.createElement('div');
    titleDiv.className = 'section-title';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'section-checkbox';
    checkbox.id = `${sectionId}-checkbox`;
    checkbox.onchange = (e: Event) => toggleSection(sectionId, (e.target as HTMLInputElement).checked);

    const titleSpan = document.createElement('span');
    titleSpan.textContent = title;

    titleDiv.appendChild(checkbox);
    titleDiv.appendChild(titleSpan);

    const childrenDiv = document.createElement('div');
    childrenDiv.className = 'section-children';

    sectionNode.appendChild(titleDiv);
    sectionNode.appendChild(childrenDiv);

    return { sectionNode, childrenDiv };
}

function updateSectionCheckboxStates(): void {
    (['tracking', 'unversioned'] as Section[]).forEach(sectionId => {
        const section = document.getElementById(sectionId);
        const sectionCheckbox = document.getElementById(`${sectionId}-checkbox`) as HTMLInputElement;
        if (!section || !sectionCheckbox) return;

        const fileCheckboxes = section.querySelectorAll('input[type="checkbox"][data-repo]') as NodeListOf<HTMLInputElement>;
        
        if (fileCheckboxes.length === 0) {
            sectionCheckbox.checked = false;
            sectionCheckbox.indeterminate = false;
            return;
        }

        let allChecked = true;
        let allUnchecked = true;

        fileCheckboxes.forEach(checkbox => {
            const repoPath = checkbox.dataset.repo;
            if (repoPath) {
                const fileTree = currentFilesBySection[repoPath]?.[sectionId];
                if (fileTree) {
                    const allFiles = getAllFilesUnderTree(fileTree);
                    const allSelected = allFiles.every(file => isFileSelected(repoPath, file));
                    const someSelected = allFiles.some(file => isFileSelected(repoPath, file));

                    if (!allSelected) allChecked = false;
                    if (someSelected) allUnchecked = false;
                }
            }
        });

        sectionCheckbox.checked = allChecked;
        sectionCheckbox.indeterminate = !allChecked && !allUnchecked;
    });
}

function updateView(): void {
    console.log('Updating view with status:', currentStatus);
    if (!currentStatus) return;

    const root = document.getElementById('tree-root');
    if (!root) return;

    // Clear the root
    root.innerHTML = '';
    currentFilesBySection = {};

    // Process versioned files (Tracking section)
    const versionedRepos = Object.entries(currentStatus.repositories)
        .filter(([_, status]) => status.versioned.length > 0);
    
    if (versionedRepos.length > 0) {
        const { sectionNode, childrenDiv } = createSectionNode('tracking', 'Tracking');
        versionedRepos.forEach(([repoPath, status]) => {
            // Create file tree for this repo's tracking section
            if (!currentFilesBySection[repoPath]) {
                currentFilesBySection[repoPath] = {
                    tracking: createFileTree(status.versioned),
                    unversioned: { _files: [] }
                };
            } else {
                currentFilesBySection[repoPath].tracking = createFileTree(status.versioned);
            }

            const repoNode = createRepoNode(repoPath, status.versioned, 'tracking');
            if (repoNode) {
                childrenDiv.appendChild(repoNode);
            }
        });
        root.appendChild(sectionNode);
    }

    // Process unversioned files (Unversioned section)
    const unversionedRepos = Object.entries(currentStatus.repositories)
        .filter(([_, status]) => status.unversioned.length > 0);
    
    if (unversionedRepos.length > 0) {
        const { sectionNode, childrenDiv } = createSectionNode('unversioned', 'Unversioned');
        unversionedRepos.forEach(([repoPath, status]) => {
            // Create file tree for this repo's unversioned section
            if (!currentFilesBySection[repoPath]) {
                currentFilesBySection[repoPath] = {
                    tracking: { _files: [] },
                    unversioned: createFileTree(status.unversioned)
                };
            } else {
                currentFilesBySection[repoPath].unversioned = createFileTree(status.unversioned);
            }

            const repoNode = createRepoNode(repoPath, status.unversioned, 'unversioned');
            if (repoNode) {
                childrenDiv.appendChild(repoNode);
            }
        });
        root.appendChild(sectionNode);
    }

    // Update section checkbox states
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

function createRepoNode(repoPath: string, files: string[], section: Section): HTMLElement | null {
    if (!files || files.length === 0) return null;
    
    const repoId = `${section}-${repoPath}`.replace(/[^a-zA-Z0-9-]/g, '-');
    const repoName = repoPath.split('/').pop() || '';
    const repoFiles = selectedFiles.get(repoPath) || new Set();
    const allSelected = files.every(file => repoFiles.has(file));

    // Create main repo node
    const repoNode = document.createElement('div');
    repoNode.id = repoId;
    repoNode.className = 'tree-node';
    repoNode.tabIndex = 0;

    // Create content wrapper
    const contentDiv = document.createElement('div');
    contentDiv.className = 'tree-content repo-node';

    // Create toggle button
    const toggleSpan = document.createElement('span');
    toggleSpan.id = `toggle-${repoId}`;
    toggleSpan.className = 'tree-toggle codicon codicon-chevron-right';
    toggleSpan.onclick = () => toggleNode(repoId);

    // Create label div
    const labelDiv = document.createElement('div');
    labelDiv.className = 'tree-label';

    // Create checkbox
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = allSelected;
    checkbox.onchange = () => toggleAllFiles(repoPath, section);

    // Create repo name span
    const nameSpan = document.createElement('span');
    nameSpan.textContent = repoName;

    // Assemble the label
    labelDiv.appendChild(checkbox);
    labelDiv.appendChild(nameSpan);

    // Assemble the content div
    contentDiv.appendChild(toggleSpan);
    contentDiv.appendChild(labelDiv);

    // Create children container
    const childrenDiv = document.createElement('div');
    childrenDiv.id = `children-${repoId}`;
    childrenDiv.className = 'tree-children';
    childrenDiv.style.display = 'none';

    if (isTreeView) {
        // Create file tree for hierarchical view
        const fileTree = currentFilesBySection[repoPath]?.[section];
        if (!fileTree) return null;
        
        // Add directories and files
        const entries = Object.entries(fileTree).filter(([key]) => key !== '_files');
        for (const [dirname, subtree] of entries) {
            if (!Array.isArray(subtree)) {
                childrenDiv.appendChild(
                    createDirectoryNode(dirname, dirname, subtree, section, repoPath)
                );
            }
        }

        // Add root-level files
        fileTree._files.forEach(file => {
            childrenDiv.appendChild(createFileNode(repoPath, file, section));
        });
    } else {
        // Flat view - just add all files
        files.forEach(file => {
            childrenDiv.appendChild(createFileNode(repoPath, file, section));
        });
    }

    // Assemble the final repo node
    repoNode.appendChild(contentDiv);
    repoNode.appendChild(childrenDiv);

    return repoNode;
}

function toggleAllFiles(repoPath: string, section: Section): void {
    const fileTree = currentFilesBySection[repoPath]?.[section];
    if (!fileTree) return;

    const allFiles = getAllFilesUnderTree(fileTree);
    const repoFiles = selectedFiles.get(repoPath) || new Set();
    const allSelected = allFiles.every(file => repoFiles.has(file));

    allFiles.forEach(file => {
        if (allSelected) {
            unselectFile(repoPath, file);
        } else {
            selectFile(repoPath, file);
        }
    });

    updateView();
}

function createFileTree(files: string[]): FileTreeNode {
    const tree: FileTreeNode = { _files: [] };
    files.forEach(file => {
        const parts = file.split('/');
        let current = tree;
        parts.forEach((part, index) => {
            if (index === parts.length - 1) {
                // Leaf node (file)
                current._files.push(file);
            } else {
                // Directory node
                if (!current[part] || Array.isArray(current[part])) {
                    current[part] = { _files: [] };
                }
                current = current[part] as FileTreeNode;
            }
        });
    });
    return tree;
}

function createDirectoryNode(path: string, name: string, tree: FileTreeNode, section: Section, repoPath: string): HTMLDivElement {
    const dirId = `${section}-${repoPath}-${path}`.replace(/[^a-zA-Z0-9-]/g, '-');
    const files = tree._files;
    const dirs = Object.entries(tree).filter(([key]) => key !== '_files');

    // Create main directory node
    const dirNode = document.createElement('div');
    dirNode.id = dirId;
    dirNode.className = 'tree-node';
    dirNode.tabIndex = 0;

    // Create content wrapper
    const contentDiv = document.createElement('div');
    contentDiv.className = 'tree-content directory-node';

    // Create toggle button
    const toggleSpan = document.createElement('span');
    toggleSpan.id = `toggle-${dirId}`;
    toggleSpan.className = 'tree-toggle codicon codicon-chevron-right';
    toggleSpan.onclick = () => toggleNode(dirId);

    // Create label div
    const labelDiv = document.createElement('div');
    labelDiv.className = 'tree-label';

    // Create checkbox
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'directory-checkbox';
    checkbox.dataset.repo = repoPath;
    checkbox.dataset.dir = path;
    checkbox.onchange = (e: Event) => toggleDirectoryFiles(repoPath, path, (e.target as HTMLInputElement).checked, section);

    // Get all files under this directory for checkbox state
    const allFiles = getAllFilesUnderTree(tree);
    const allSelected = allFiles.length > 0 && allFiles.every(file => isFileSelected(repoPath, file));
    const someSelected = allFiles.some(file => isFileSelected(repoPath, file));
    checkbox.checked = allSelected;
    checkbox.indeterminate = !allSelected && someSelected;

    // Create directory name span
    const nameSpan = document.createElement('span');
    nameSpan.textContent = name;

    // Assemble the label
    labelDiv.appendChild(checkbox);
    labelDiv.appendChild(nameSpan);

    // Assemble the content div
    contentDiv.appendChild(toggleSpan);
    contentDiv.appendChild(labelDiv);

    // Create children container
    const childrenDiv = document.createElement('div');
    childrenDiv.id = `children-${dirId}`;
    childrenDiv.className = 'tree-children';

    // Add subdirectories
    dirs.forEach(([dirname, subtree]) => {
        if (!Array.isArray(subtree) && dirname !== '_files') {
            const subdirPath = path ? `${path}/${dirname}` : dirname;
            childrenDiv.appendChild(
                createDirectoryNode(subdirPath, dirname, subtree, section, repoPath)
            );
        }
    });

    // Add files
    files.forEach(file => {
        childrenDiv.appendChild(createFileNode(repoPath, file, section));
    });

    // Assemble the final directory node
    dirNode.appendChild(contentDiv);
    dirNode.appendChild(childrenDiv);

    return dirNode;
}

function createFileNode(repoPath: string, file: string, section: Section): HTMLDivElement {
    const fileId = `${section}-${repoPath}-${file}`.replace(/[^a-zA-Z0-9-]/g, '-');
    const fileName = file.split('/').pop() || '';
    const repoFiles = selectedFiles.get(repoPath) || new Set();

    // Create main file node
    const fileNode = document.createElement('div');
    fileNode.id = fileId;
    fileNode.className = 'tree-node';
    fileNode.tabIndex = 0;

    // Create content wrapper
    const contentDiv = document.createElement('div');
    contentDiv.className = `tree-content file-node ${section}`;

    // Create empty toggle span (for alignment)
    const toggleSpan = document.createElement('span');
    toggleSpan.className = 'tree-toggle no-children';

    // Create label div
    const labelDiv = document.createElement('div');
    labelDiv.className = 'tree-label';

    // Create checkbox
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = repoFiles.has(file);
    checkbox.onchange = () => toggleFile(repoPath, file);

    // Create file name span
    const nameSpan = document.createElement('span');
    nameSpan.textContent = isTreeView ? fileName : file;

    // Assemble the label
    labelDiv.appendChild(checkbox);
    labelDiv.appendChild(nameSpan);

    // Assemble the content div
    contentDiv.appendChild(toggleSpan);
    contentDiv.appendChild(labelDiv);

    // Assemble the final file node
    fileNode.appendChild(contentDiv);

    return fileNode;
}

function toggleAllInSection(sectionId: Section): void {
    console.log(`Toggling all files in section: ${sectionId}`);
    const checkbox = document.querySelector(`#toggle-${sectionId}`)?.nextElementSibling as HTMLInputElement;
    if (!checkbox || !currentStatus) return;

    const isChecked = checkbox.checked;
    console.log(`Section checkbox state: ${isChecked}`);

    // Clear indeterminate state
    checkbox.indeterminate = false;

    // Get all repositories for this section
    const repos = Object.entries(currentStatus.repositories);
    console.log(`Found ${repos.length} repositories`);

    repos.forEach(([repoPath, status]) => {
        let repoFiles = selectedFiles.get(repoPath);
        if (!repoFiles) {
            repoFiles = new Set();
            selectedFiles.set(repoPath, repoFiles);
        }

        // Get files based on section
        const files = sectionId === 'tracking' ? status.versioned : status.unversioned;
        console.log(`Processing ${files.length} files for repo ${repoPath}`);

        if (isChecked) {
            // Select all files
            files.forEach(file => repoFiles.add(file));
        } else {
            // Unselect all files
            files.forEach(file => repoFiles.delete(file));
        }
    });

    updateView();
    updateCommitButton();
}

function toggleDirectoryFiles(repoPath: string, dirPath: string, isChecked: boolean, section: Section): void {
    const fileTree = currentFilesBySection[repoPath]?.[section];
    if (!fileTree) return;

    const subtree = getSubtreeFromPath(fileTree, dirPath);
    if (!subtree) return;

    // Get all files under this directory and its subdirectories
    const allFiles = getAllFilesUnderTree(subtree);

    // Toggle all files
    allFiles.forEach(file => {
        if (isChecked) {
            selectFile(repoPath, file);
        } else {
            unselectFile(repoPath, file);
        }
    });

    // Update parent directory checkboxes
    updateParentDirectoryCheckboxes(repoPath, dirPath, section);
    
    // Update child directory checkboxes
    updateChildDirectoryCheckboxes(repoPath, dirPath, isChecked, section);

    updateCommitButton();
    updateView();
}

function updateChildDirectoryCheckboxes(repoPath: string, dirPath: string, isChecked: boolean, section: Section): void {
    // Update immediate child checkboxes
    const selector = `.directory-checkbox[data-repo="${repoPath}"][data-dir^="${dirPath}/"]`;
    const childCheckboxes = document.querySelectorAll(selector);
    
    childCheckboxes.forEach(checkbox => {
        const childPath = (checkbox as HTMLInputElement).dataset.dir || '';
        const subtree = getSubtreeFromPath(currentFilesBySection[repoPath]?.[section], childPath);
        if (subtree) {
            (checkbox as HTMLInputElement).checked = isChecked;
            (checkbox as HTMLInputElement).indeterminate = false;
        }
    });
}

function getAllFilesUnderTree(tree: FileTreeNode): string[] {
    if (!tree) return [];
    
    let files: string[] = [];
    
    // Add files from current directory
    files.push(...tree._files);
    
    // Add files from subdirectories
    Object.entries(tree).forEach(([key, subtree]) => {
        if (key !== '_files' && !Array.isArray(subtree)) {
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

function updateParentDirectoryCheckboxes(repoPath: string, dirPath: string, section: Section): void {
    const pathParts = dirPath.split('/');
    let currentPath = '';
    
    // Update each parent directory's checkbox state
    for (let i = 0; i < pathParts.length; i++) {
        currentPath = currentPath ? `${currentPath}/${pathParts[i]}` : pathParts[i];
        const checkbox = document.querySelector(`.directory-checkbox[data-repo="${repoPath}"][data-dir="${currentPath}"]`) as HTMLInputElement;
        if (checkbox) {
            const subtree = getSubtreeFromPath(currentFilesBySection[repoPath]?.[section], currentPath);
            if (subtree) {
                const allFiles = getAllFilesUnderTree(subtree);
                const allSelected = allFiles.length > 0 && allFiles.every(file => isFileSelected(repoPath, file));
                const someSelected = allFiles.some(file => isFileSelected(repoPath, file));
                
                checkbox.checked = allSelected;
                checkbox.indeterminate = !allSelected && someSelected;
            }
        }
    }
}

function selectFile(repoPath: string, file: string): void {
    const repoFiles = selectedFiles.get(repoPath);
    if (!repoFiles) {
        selectedFiles.set(repoPath, new Set([file]));
    } else {
        repoFiles.add(file);
    }
}

function unselectFile(repoPath: string, file: string): void {
    const repoFiles = selectedFiles.get(repoPath);
    if (repoFiles) {
        repoFiles.delete(file);
        if (repoFiles.size === 0) {
            selectedFiles.delete(repoPath);
        }
    }
}

function isFileSelected(repoPath: string, file: string): boolean {
    const repoFiles = selectedFiles.get(repoPath);
    return Boolean(repoFiles && repoFiles.has(file));
}

function updateCommitButton(): void {
    const commitButton = document.getElementById('commit-button') as HTMLButtonElement;
    const commitMessage = document.getElementById('commit-message') as HTMLTextAreaElement;
    
    // Log current state
    console.log('[updateCommitButton] Commit message:', commitMessage?.value);
    console.log('[updateCommitButton] Selected files:', Array.from(selectedFiles.entries()).map(([repo, files]) => ({
        repo,
        files: Array.from(files)
    })));
    
    const hasSelectedFiles = Array.from(selectedFiles.values()).some(files => files.size > 0);
    console.log('[updateCommitButton] Has selected files:', hasSelectedFiles);
    
    if (commitButton) {
        const isEnabled = commitMessage.value.trim() !== '' && hasSelectedFiles;
        console.log('[updateCommitButton] Button enabled:', isEnabled);
        commitButton.disabled = !isEnabled;
    }
}

function getSelectedPaths(): Array<{ path: string, repo: string }> {
    console.log('[getSelectedPaths] Getting selected paths...');
    
    const selectedPaths: Array<{ path: string, repo: string }> = [];
    selectedFiles.forEach((files, repoPath) => {
        console.log(`[getSelectedPaths] Processing repo: ${repoPath}, files:`, Array.from(files));
        files.forEach(file => {
            console.log(`[getSelectedPaths] Adding file: ${file} from repo: ${repoPath}`);
            selectedPaths.push({
                path: file,
                repo: repoPath
            });
        });
    });
    console.log('[getSelectedPaths] Final selected paths:', selectedPaths);
    return selectedPaths;
}

function handleCommit(): void {
    console.log('[handleCommit] Starting commit...');
    const commitMessage = (document.getElementById('commit-message') as HTMLTextAreaElement).value;
    console.log('[handleCommit] Commit message:', commitMessage);

    const selectedPaths = getSelectedPaths();
    console.log('[handleCommit] Selected paths:', selectedPaths);

    if (!commitMessage) {
        console.warn('[handleCommit] No commit message provided');
        updateStatusMessage('Please enter a commit message', 'error');
        return;
    }

    if (selectedPaths.length === 0) {
        console.warn('[handleCommit] No files selected');
        updateStatusMessage('Please select files to commit', 'error');
        return;
    }

    console.log('[handleCommit] Sending commit message to VS Code');
    vscode.postMessage({
        type: 'commit',
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

function getNextVisibleNode(currentNode: HTMLElement | null, direction: 'up' | 'down'): HTMLElement | null {
    if (!currentNode) return null;

    // Helper function to check if a node is visible
    const isNodeVisible = (node: HTMLElement): boolean => {
        let current: HTMLElement | null = node;
        while (current && current.id !== 'tree-root') {
            if (current.style.display === 'none') return false;
            if (current.classList.contains('tree-children')) {
                const parentToggle = current.previousElementSibling?.querySelector('.tree-toggle');
                if (parentToggle?.classList.contains('codicon-chevron-right')) return false;
            }
            current = current.parentElement;
        }
        return true;
    };

    // Helper function to get all focusable nodes
    const getAllFocusableNodes = (): HTMLElement[] => {
        return Array.from(document.querySelectorAll('.tree-node, .section'));
    };

    const allNodes = getAllFocusableNodes();
    const currentIndex = allNodes.indexOf(currentNode);
    
    if (currentIndex === -1) return null;

    if (direction === 'down') {
        // Find next visible node
        for (let i = currentIndex + 1; i < allNodes.length; i++) {
            if (isNodeVisible(allNodes[i])) {
                return allNodes[i];
            }
        }
    } else {
        // Find previous visible node
        for (let i = currentIndex - 1; i >= 0; i--) {
            if (isNodeVisible(allNodes[i])) {
                return allNodes[i];
            }
        }
    }

    return null;
}

function focusNode(node: HTMLElement): void {
    // Remove focus from previously focused node
    if (focusedNodeId) {
        const prevNode = document.getElementById(focusedNodeId);
        if (prevNode) {
            prevNode.blur();
        }
    }

    // Focus the new node
    focusedNodeId = node.id;
    node.focus();
    node.scrollIntoView({ block: 'nearest' });
}

function handleKeyboardNavigation(event: KeyboardEvent): void {
    const currentNode = focusedNodeId ? document.getElementById(focusedNodeId) : null;
    let nextNode: HTMLElement | null = null;

    switch (event.key) {
        case 'ArrowUp':
            event.preventDefault();
            nextNode = getNextVisibleNode(currentNode as HTMLElement, 'up');
            break;

        case 'ArrowDown':
            event.preventDefault();
            nextNode = getNextVisibleNode(currentNode as HTMLElement, 'down');
            break;

        case 'ArrowRight':
            if (currentNode) {
                event.preventDefault();
                if (currentNode.classList.contains('section')) {
                    // For sections, just expand the section if it's collapsed
                    const childrenDiv = currentNode.querySelector('.section-children') as HTMLElement;
                    if (childrenDiv && childrenDiv.style.display === 'none') {
                        childrenDiv.style.display = 'block';
                        // Focus first child if available
                        const firstChild = childrenDiv.querySelector('.tree-node, .section') as HTMLElement;
                        if (firstChild) {
                            nextNode = firstChild;
                        }
                    }
                } else {
                    // For tree nodes, use the toggle button
                    const toggleButton = currentNode.querySelector('.tree-toggle');
                    if (toggleButton?.classList.contains('codicon-chevron-right')) {
                        toggleNode(currentNode.id);
                        // Focus first child if available
                        const childrenDiv = document.getElementById(`children-${currentNode.id}`);
                        if (childrenDiv) {
                            const firstChild = childrenDiv.querySelector('.tree-node') as HTMLElement;
                            if (firstChild) {
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
                    // For sections, just collapse the section if it's expanded
                    const childrenDiv = currentNode.querySelector('.section-children') as HTMLElement;
                    if (childrenDiv && childrenDiv.style.display === 'block') {
                        childrenDiv.style.display = 'none';
                    }
                } else {
                    // For tree nodes, handle collapse or move to parent
                    const toggleButton = currentNode.querySelector('.tree-toggle');
                    if (toggleButton?.classList.contains('codicon-chevron-down')) {
                        toggleNode(currentNode.id);
                    } else {
                        // If already collapsed, move to parent
                        const parentElement = currentNode.parentElement?.closest('.tree-node, .section');
                        if (parentElement instanceof HTMLElement) {
                            nextNode = parentElement;
                        }
                    }
                }
            }
            break;

        case ' ':
        case 'Enter':
            if (currentNode) {
                event.preventDefault();
                const checkbox = currentNode.querySelector('input[type="checkbox"]') as HTMLInputElement;
                if (checkbox) {
                    checkbox.click();
                }
            }
            break;
    }

    if (nextNode) {
        focusNode(nextNode);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    console.log('[init] Setting up commit button handler');
    const commitButton = document.getElementById('commit-button');
    console.log('[init] Found commit button:', commitButton);
    
    if (commitButton) {
        commitButton.addEventListener('click', () => {
            console.log('[commit-button] Commit button clicked');
            handleCommit();
        });
    }
});

document.addEventListener('keydown', (event: KeyboardEvent) => {
    // Don't handle keyboard events if commit message has focus
    const commitMessage = document.getElementById('commit-message');
    if (commitMessage && document.activeElement === commitMessage) {
        return;
    }

    if (!focusedNodeId) {
        // If no node is focused, focus the first visible node
        const firstNode = getNextVisibleNode(document.querySelector('.tree-node, .section'), 'down');
        if (firstNode) {
            focusNode(firstNode);
            event.preventDefault();
            return;
        }
    }
    
    handleKeyboardNavigation(event);
});

document.getElementById('commit-message')?.addEventListener('input', updateCommitButton);

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

    // Add event listeners
    document.getElementById('push-yes')?.addEventListener('click', () => {
        vscode.postMessage({ type: 'push' });
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
    
    // Clear the message after 5 seconds if it's a success message
    if (type === 'success') {
        setTimeout(() => {
            if (statusArea) {
                statusArea.textContent = '';
                statusArea.className = 'status-message';
            }
        }, 5000);
    }
}

// Event Listeners
window.addEventListener('message', (event: MessageEvent<any>) => {
    const message = event.data;
    console.log('Received message:', message);
    
    switch (message.type) {
        case 'updateChanges':
            currentStatus = message.status;
            updateView();
            break;
        case 'toggleViewMode':
            isTreeView = message.isTreeView;
            updateView();
            break;
        case 'error':
            console.error('Error:', message.error);
            updateStatusMessage(message.error, 'error');
            break;
        case 'commitSuccess':
            updateStatusMessage('Changes committed successfully');
            showPushPrompt();
            // Clear commit message after successful commit
            const commitMessage = document.getElementById('commit-message') as HTMLTextAreaElement;
            if (commitMessage) {
                commitMessage.value = '';
                updateCommitButton();
            }
            break;
        case 'pushSuccess':
            updateStatusMessage('Changes pushed successfully!', 'success');
            break;
        case 'pushError':
            updateStatusMessage('Failed to push changes: ' + message.error, 'error');
            break;
        default:
            console.warn('Unknown message type:', message.type);
    }
});