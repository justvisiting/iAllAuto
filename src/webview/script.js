const vscode = acquireVsCodeApi();
let currentStatus = null;
let selectedFiles = new Map();
let expandedNodes = new Set();
let focusedNodeId = null;
let isTreeView = true;

function refreshChanges() {
    vscode.postMessage({ type: 'refresh' });
}

function toggleNode(nodeId) {
    console.log(`Toggling node: ${nodeId}`);
    const childrenElement = document.getElementById(`children-${nodeId}`);
    const toggleElement = document.getElementById(`toggle-${nodeId}`);
    
    if (childrenElement.classList.contains('expanded')) {
        console.log(`Collapsing node: ${nodeId}`);
        childrenElement.classList.remove('expanded');
        toggleElement.className = 'tree-toggle codicon codicon-chevron-right';
        expandedNodes.delete(nodeId);
    } else {
        console.log(`Expanding node: ${nodeId}`);
        childrenElement.classList.add('expanded');
        toggleElement.className = 'tree-toggle codicon codicon-chevron-down';
        expandedNodes.add(nodeId);
    }
}

function toggleAllFiles(repoPath, type) {
    console.log(`Toggling all files in repo: ${repoPath}, type: ${type}`);
    const status = currentStatus.repositories[repoPath];
    const files = type === 'versioned' ? status.versioned : status.unversioned;
    let repoFiles = selectedFiles.get(repoPath);
    
    if (!repoFiles) {
        repoFiles = new Set();
        selectedFiles.set(repoPath, repoFiles);
    }

    const allSelected = files.every(file => repoFiles.has(file));
    console.log(`All files selected: ${allSelected}`);
    
    if (allSelected) {
        console.log('Unselecting all files');
        files.forEach(file => repoFiles.delete(file));
    } else {
        console.log('Selecting all files');
        files.forEach(file => repoFiles.add(file));
    }
    
    updateView();
}

function toggleFile(repoPath, file) {
    console.log(`Toggling file: ${file} in repo: ${repoPath}`);
    let repoFiles = selectedFiles.get(repoPath);
    if (!repoFiles) {
        repoFiles = new Set();
        selectedFiles.set(repoPath, repoFiles);
    }

    if (repoFiles.has(file)) {
        console.log(`Unselecting file: ${file}`);
        repoFiles.delete(file);
    } else {
        console.log(`Selecting file: ${file}`);
        repoFiles.add(file);
    }

    // Update section checkbox state
    const section = file.startsWith('.') ? 'unversioned' : 'tracking';
    updateSectionCheckboxState(section);

    updateView();
}

function toggleAllInSection(sectionId) {
    console.log(`Toggling all files in section: ${sectionId}`);
    const checkbox = document.querySelector(`#toggle-${sectionId}`).nextElementSibling;
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

function updateSectionCheckboxState(sectionId) {
    console.log(`Updating section checkbox state for: ${sectionId}`);
    const checkbox = document.querySelector(`#toggle-${sectionId}`).nextElementSibling;
    const section = document.getElementById(`children-${sectionId}`);
    const fileCheckboxes = Array.from(section.querySelectorAll('.file-node input[type="checkbox"]'));
    
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

function createSectionNode(id, label) {
    const sectionNode = document.createElement('div');
    sectionNode.id = id;
    sectionNode.className = 'tree-node';
    sectionNode.tabIndex = 0;

    const contentDiv = document.createElement('div');
    contentDiv.className = 'tree-content root-node';

    const toggleSpan = document.createElement('span');
    toggleSpan.id = `toggle-${id}`;
    toggleSpan.className = 'tree-toggle codicon codicon-chevron-right';
    toggleSpan.onclick = () => toggleNode(id);

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'section-checkbox';
    checkbox.onchange = () => toggleAllInSection(id);

    const labelSpan = document.createElement('span');
    labelSpan.className = 'tree-label';
    labelSpan.textContent = label;

    contentDiv.appendChild(toggleSpan);
    contentDiv.appendChild(checkbox);
    contentDiv.appendChild(labelSpan);

    const childrenDiv = document.createElement('div');
    childrenDiv.id = `children-${id}`;
    childrenDiv.className = 'tree-children';

    sectionNode.appendChild(contentDiv);
    sectionNode.appendChild(childrenDiv);

    return { sectionNode, childrenDiv };
}

function updateView() {
    const root = document.getElementById('tree-root');
    root.innerHTML = '';

    if (!currentStatus) {
        console.log('No current status available');
        return;
    }

    // Create tracking section
    const versionedRepos = Object.entries(currentStatus.repositories)
        .filter(([_, status]) => status.versioned.length > 0);
    
    if (versionedRepos.length > 0) {
        const { sectionNode, childrenDiv } = createSectionNode('tracking', 'Tracking');
        versionedRepos.forEach(([repoPath, status]) => {
            const repoNode = createRepoNode(repoPath, status.versioned, 'versioned');
            if (repoNode) {
                childrenDiv.appendChild(repoNode);
            }
        });
        root.appendChild(sectionNode);
    }

    // Create unversioned section
    const unversionedRepos = Object.entries(currentStatus.repositories)
        .filter(([_, status]) => status.unversioned.length > 0);
    
    if (unversionedRepos.length > 0) {
        const { sectionNode, childrenDiv } = createSectionNode('unversioned', 'Unversioned Files');
        unversionedRepos.forEach(([repoPath, status]) => {
            const repoNode = createRepoNode(repoPath, status.unversioned, 'unversioned');
            if (repoNode) {
                childrenDiv.appendChild(repoNode);
            }
        });
        root.appendChild(sectionNode);
    }

    // Restore expanded state
    expandedNodes.forEach(nodeId => {
        const childrenElement = document.getElementById(`children-${nodeId}`);
        const toggleElement = document.getElementById(`toggle-${nodeId}`);
        if (childrenElement && toggleElement) {
            childrenElement.classList.add('expanded');
            toggleElement.className = 'tree-toggle codicon codicon-chevron-down';
        }
    });

    // Update section checkbox states
    updateSectionCheckboxState('tracking');
    updateSectionCheckboxState('unversioned');

    updateCommitButton();
}

function createRepoNode(repoPath, files, type) {
    if (!files || files.length === 0) return null;
    
    const repoId = `${type}-${repoPath}`.replace(/[^a-zA-Z0-9-]/g, '-');
    const repoName = repoPath.split('/').pop();
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
    checkbox.onchange = () => toggleAllFiles(repoPath, type);

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

    if (isTreeView) {
        // Create file tree for hierarchical view
        const fileTree = createFileTree(files);
        
        // Add directories
        Object.entries(fileTree)
            .filter(([key]) => key !== '_files')
            .forEach(([dirname, subtree]) => {
                childrenDiv.appendChild(
                    createDirectoryNode(dirname, dirname, subtree, type, repoPath)
                );
            });

        // Add root-level files
        if (fileTree._files) {
            fileTree._files.forEach(file => {
                childrenDiv.appendChild(createFileNode(repoPath, file, type));
            });
        }
    } else {
        // Flat view - just add all files
        files.forEach(file => {
            childrenDiv.appendChild(createFileNode(repoPath, file, type));
        });
    }

    // Assemble the final repo node
    repoNode.appendChild(contentDiv);
    repoNode.appendChild(childrenDiv);

    return repoNode;
}

function createFileTree(files) {
    const tree = {};
    files.forEach(file => {
        const parts = file.split('/');
        let current = tree;
        parts.forEach((part, index) => {
            if (index === parts.length - 1) {
                // Leaf node (file)
                if (!current._files) current._files = [];
                current._files.push(file);
            } else {
                // Directory node
                if (!current[part]) current[part] = {};
                current = current[part];
            }
        });
    });
    return tree;
}

function createDirectoryNode(path, name, tree, type, repoPath) {
    const dirId = `${type}-${repoPath}-${path}`.replace(/[^a-zA-Z0-9-]/g, '-');
    const files = tree._files || [];
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
    checkbox.onchange = (e) => toggleDirectoryFiles(repoPath, path, e.target.checked);

    // Get all files under this directory for checkbox state
    const allFiles = getAllFilesUnderTree(tree);
    const allSelected = allFiles.every(file => isFileSelected(repoPath, file));
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
        const subdirPath = path ? `${path}/${dirname}` : dirname;
        childrenDiv.appendChild(
            createDirectoryNode(subdirPath, dirname, subtree, type, repoPath)
        );
    });

    // Add files
    files.forEach(file => {
        childrenDiv.appendChild(createFileNode(repoPath, file, type));
    });

    // Assemble the final directory node
    dirNode.appendChild(contentDiv);
    dirNode.appendChild(childrenDiv);

    return dirNode;
}

function getAllFilesUnderTree(tree) {
    const files = tree._files || [];
    const dirs = Object.entries(tree).filter(([key]) => key !== '_files');

    return dirs.reduce((acc, [_, subtree]) => {
        return acc.concat(getAllFilesUnderTree(subtree));
    }, files);
}

function toggleDirectoryFiles(repoPath, dirPath, isChecked) {
    const fileTree = currentFilesByRepo[repoPath];
    if (!fileTree) return;

    // Get the subtree for this directory
    const pathParts = dirPath.split('/');
    let currentTree = fileTree;
    for (const part of pathParts) {
        if (!currentTree[part]) break;
        currentTree = currentTree[part];
    }

    // Get all files under this directory
    const allFiles = getAllFilesUnderTree(currentTree);
    
    // Toggle all files
    allFiles.forEach(file => {
        if (isChecked) {
            selectFile(repoPath, file);
        } else {
            unselectFile(repoPath, file);
        }
    });

    // Update all parent directory checkboxes
    updateParentDirectoryCheckboxes(repoPath, dirPath);
    
    // Update all child directory checkboxes
    updateChildDirectoryCheckboxes(repoPath, dirPath, isChecked);

    updateCommitButton();
}

function updateParentDirectoryCheckboxes(repoPath, dirPath) {
    const pathParts = dirPath.split('/');
    let currentPath = '';
    
    // Update each parent directory's checkbox state
    for (let i = 0; i < pathParts.length; i++) {
        currentPath = currentPath ? `${currentPath}/${pathParts[i]}` : pathParts[i];
        const checkbox = document.querySelector(`.directory-checkbox[data-repo="${repoPath}"][data-dir="${currentPath}"]`);
        if (checkbox) {
            const subtree = getSubtreeFromPath(currentFilesByRepo[repoPath], currentPath);
            if (subtree) {
                const allFiles = getAllFilesUnderTree(subtree);
                const allSelected = allFiles.every(file => isFileSelected(repoPath, file));
                const someSelected = allFiles.some(file => isFileSelected(repoPath, file));
                
                checkbox.checked = allSelected;
                checkbox.indeterminate = !allSelected && someSelected;
            }
        }
    }
}

function updateChildDirectoryCheckboxes(repoPath, dirPath, isChecked) {
    const selector = `.directory-checkbox[data-repo="${repoPath}"][data-dir^="${dirPath}/"]`;
    const childCheckboxes = document.querySelectorAll(selector);
    
    childCheckboxes.forEach(checkbox => {
        checkbox.checked = isChecked;
        checkbox.indeterminate = false;
    });
}

function getSubtreeFromPath(tree, path) {
    if (!path) return tree;
    const parts = path.split('/');
    let current = tree;
    
    for (const part of parts) {
        if (!current[part]) return null;
        current = current[part];
    }
    
    return current;
}

function getAllFilesUnderTree(tree) {
    if (!tree) return [];
    
    const files = [...(tree._files || [])];
    Object.entries(tree)
        .filter(([key]) => key !== '_files')
        .forEach(([_, subtree]) => {
            files.push(...getAllFilesUnderTree(subtree));
        });
    
    return files;
}

function createFileNode(repoPath, file, type) {
    const fileId = `${type}-${repoPath}-${file}`.replace(/[^a-zA-Z0-9-]/g, '-');
    const fileName = file.split('/').pop();
    const repoFiles = selectedFiles.get(repoPath) || new Set();

    // Create main file node
    const fileNode = document.createElement('div');
    fileNode.id = fileId;
    fileNode.className = 'tree-node';
    fileNode.tabIndex = 0;

    // Create content wrapper
    const contentDiv = document.createElement('div');
    contentDiv.className = `tree-content file-node ${type}`;

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

function toggleNodeSelection(nodeId) {
    console.log('Toggling node:', nodeId);
    
    // For any node type, find the checkbox within its content div
    const node = document.getElementById(nodeId);
    if (!node) {
        console.log('Node not found:', nodeId);
        return;
    }
    
    const checkbox = node.querySelector('.tree-content input[type="checkbox"]');
    if (checkbox) {
        console.log('Found checkbox, clicking');
        checkbox.click();
    } else {
        console.log('No checkbox found in node');
    }
}

function updateCommitButton() {
    const message = document.getElementById('commit-message').value;
    const hasFiles = Array.from(selectedFiles.values())
        .some(files => files.size > 0);
    document.getElementById('commit-button').disabled = !message || !hasFiles;
}

function commitChanges() {
    const message = document.getElementById('commit-message').value;
    const files = [];
    for (const [repo, fileSet] of selectedFiles.entries()) {
        for (const file of fileSet) {
            files.push({ repo, path: file });
        }
    }
    vscode.postMessage({
        type: 'commit',
        message,
        files
    });
}

window.addEventListener('message', event => {
    const message = event.data;
    console.log('Received message:', message);
    switch (message.type) {
        case 'updateChanges':
            currentStatus = message.status;
            updateView();
            break;
        case 'toggleViewMode':
            console.log('Toggling view mode to:', message.isTreeView);
            isTreeView = message.isTreeView;
            updateView();
            break;
    }
});

document.addEventListener('keydown', handleKeyDown);

function handleKeyDown(event) {
    if (!focusedNodeId) {
        // If nothing is focused, focus the first node
        const firstNode = document.querySelector('.tree-node');
        if (firstNode) {
            focusNode(firstNode.id || 'tracking');
        }
        return;
    }

    switch (event.key) {
        case 'ArrowUp':
            event.preventDefault();
            moveFocus('prev');
            break;
        case 'ArrowDown':
            event.preventDefault();
            moveFocus('next');
            break;
        case 'ArrowRight':
            event.preventDefault();
            if (!isNodeExpanded(focusedNodeId)) {
                toggleNode(focusedNodeId);
            } else {
                // If already expanded, move to first child
                const firstChild = document.querySelector(`#children-${focusedNodeId} > .tree-node:first-child`);
                if (firstChild) {
                    focusNode(firstChild.id);
                }
            }
            break;
        case 'ArrowLeft':
            event.preventDefault();
            if (isNodeExpanded(focusedNodeId)) {
                toggleNode(focusedNodeId);
            } else {
                // If already collapsed, move to parent
                const parentNode = findParentNode(focusedNodeId);
                if (parentNode) {
                    focusNode(parentNode.id);
                }
            }
            break;
        case ' ':
            event.preventDefault();
            toggleNodeSelection(focusedNodeId);
            break;
    }
}

function moveFocus(direction) {
    const allNodes = Array.from(document.querySelectorAll('.tree-node'));
    const visibleNodes = allNodes.filter(node => {
        // Node is visible if it's not inside a collapsed parent
        let parent = node.parentElement;
        while (parent) {
            if (parent.classList.contains('tree-children') && !parent.classList.contains('expanded')) {
                return false;
            }
            parent = parent.parentElement;
        }
        return true;
    });

    const currentIndex = visibleNodes.findIndex(node => node.id === focusedNodeId);
    let newIndex;

    if (direction === 'next') {
        newIndex = currentIndex + 1;
        if (newIndex >= visibleNodes.length) newIndex = 0;
    } else {
        newIndex = currentIndex - 1;
        if (newIndex < 0) newIndex = visibleNodes.length - 1;
    }

    focusNode(visibleNodes[newIndex].id);
}

function focusNode(nodeId) {
    // Remove focus from previous node
    if (focusedNodeId) {
        const prevNode = document.getElementById(focusedNodeId);
        if (prevNode) {
            prevNode.classList.remove('focused');
        }
    }

    // Add focus to new node
    focusedNodeId = nodeId;
    const newNode = document.getElementById(nodeId);
    if (newNode) {
        newNode.classList.add('focused');
        newNode.scrollIntoView({ block: 'nearest' });
    }
}

function isNodeExpanded(nodeId) {
    const childrenElement = document.getElementById(`children-${nodeId}`);
    return childrenElement && childrenElement.classList.contains('expanded');
}

function findParentNode(nodeId) {
    const node = document.getElementById(nodeId);
    if (!node) return null;

    let parent = node.parentElement;
    while (parent) {
        if (parent.classList.contains('tree-node')) {
            return parent;
        }
        parent = parent.parentElement;
    }
    return null;
}

document.getElementById('commit-message').addEventListener('input', updateCommitButton);

function isFileSelected(repoPath, file) {
    const repoFiles = selectedFiles.get(repoPath);
    return repoFiles && repoFiles.has(file);
}

function selectFile(repoPath, file) {
    const repoFiles = selectedFiles.get(repoPath);
    if (!repoFiles) {
        selectedFiles.set(repoPath, new Set([file]));
    } else {
        repoFiles.add(file);
    }
}

function unselectFile(repoPath, file) {
    const repoFiles = selectedFiles.get(repoPath);
    if (repoFiles) {
        repoFiles.delete(file);
        if (repoFiles.size === 0) {
            selectedFiles.delete(repoPath);
        }
    }
}
