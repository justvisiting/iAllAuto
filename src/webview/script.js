const vscode = acquireVsCodeApi();
let selectedFiles = new Map(); // Map<string, Set<string>> - repo -> files
let currentStatus = null;
let expandedNodes = new Set();

function refreshChanges() {
    vscode.postMessage({ type: 'refresh' });
}

function toggleNode(nodeId) {
    const childrenElement = document.getElementById(`children-${nodeId}`);
    const toggleElement = document.getElementById(`toggle-${nodeId}`);
    
    if (childrenElement.classList.contains('expanded')) {
        childrenElement.classList.remove('expanded');
        toggleElement.textContent = '▶';
        expandedNodes.delete(nodeId);
    } else {
        childrenElement.classList.add('expanded');
        toggleElement.textContent = '▼';
        expandedNodes.add(nodeId);
    }
}

function toggleAllFiles(repoPath, type) {
    const status = currentStatus.repositories[repoPath];
    const files = type === 'versioned' ? status.versioned : status.unversioned;
    let repoFiles = selectedFiles.get(repoPath);
    
    if (!repoFiles) {
        repoFiles = new Set();
        selectedFiles.set(repoPath, repoFiles);
    }

    const allSelected = files.every(file => repoFiles.has(file));
    
    if (allSelected) {
        // If all files are selected, unselect all
        files.forEach(file => repoFiles.delete(file));
    } else {
        // If not all files are selected, select all
        files.forEach(file => repoFiles.add(file));
    }
    
    updateView();
}

function toggleFile(repoPath, file) {
    let repoFiles = selectedFiles.get(repoPath);
    if (!repoFiles) {
        repoFiles = new Set();
        selectedFiles.set(repoPath, repoFiles);
    }

    if (repoFiles.has(file)) {
        repoFiles.delete(file);
    } else {
        repoFiles.add(file);
    }
    updateView();
}

function updateView() {
    if (!currentStatus) return;
    
    const treeHtml = [];
    
    // Create versioned files tree
    const versionedRepos = Object.entries(currentStatus.repositories)
        .filter(([_, status]) => status.versioned.length > 0)
        .map(([repoPath, status]) => 
            createRepoNode(repoPath, status.versioned, 'versioned'))
        .join('');
    
    if (versionedRepos) {
        treeHtml.push(createRootNode('tracking', 'Tracking', versionedRepos));
    }
    
    // Create unversioned files tree
    const unversionedRepos = Object.entries(currentStatus.repositories)
        .filter(([_, status]) => status.unversioned.length > 0)
        .map(([repoPath, status]) => 
            createRepoNode(repoPath, status.unversioned, 'unversioned'))
        .join('');
    
    if (unversionedRepos) {
        treeHtml.push(createRootNode('unversioned', 'Unversioned Files', unversionedRepos));
    }
    
    document.getElementById('tree-root').innerHTML = treeHtml.join('');
    
    // Restore expanded state
    expandedNodes.forEach(nodeId => {
        const childrenElement = document.getElementById(`children-${nodeId}`);
        const toggleElement = document.getElementById(`toggle-${nodeId}`);
        if (childrenElement && toggleElement) {
            childrenElement.classList.add('expanded');
            toggleElement.textContent = '▼';
        }
    });
    
    updateCommitButton();
}

function createRootNode(id, label, children) {
    return `
        <div class="tree-node">
            <div class="tree-content root-node">
                <span id="toggle-${id}" class="tree-toggle" onclick="toggleNode('${id}')">▶</span>
                <span class="tree-label">${label}</span>
            </div>
            <div id="children-${id}" class="tree-children">
                ${children || '<div class="empty-message">No files</div>'}
            </div>
        </div>
    `;
}

function createRepoNode(repoPath, files, type) {
    if (!files || files.length === 0) return '';
    
    const repoId = `${type}-${repoPath}`;
    const repoName = repoPath.split('/').pop();
    const repoFiles = selectedFiles.get(repoPath) || new Set();
    const allSelected = files.every(file => repoFiles.has(file));
    
    return `
        <div class="tree-node">
            <div class="tree-content repo-node">
                <span id="toggle-${repoId}" class="tree-toggle" onclick="toggleNode('${repoId}')">▶</span>
                <div class="tree-label">
                    <input type="checkbox" 
                           onchange="toggleAllFiles('${repoPath}', '${type}')"
                           ${allSelected ? 'checked' : ''}>
                    ${repoName}
                </div>
            </div>
            <div id="children-${repoId}" class="tree-children">
                ${files.map(file => createFileNode(repoPath, file, type)).join('')}
            </div>
        </div>
    `;
}

function createFileNode(repoPath, file, type) {
    const repoFiles = selectedFiles.get(repoPath) || new Set();
    return `
        <div class="tree-node">
            <div class="tree-content file-node ${type}">
                <span class="tree-toggle no-children"></span>
                <div class="tree-label">
                    <input type="checkbox" 
                           onchange="toggleFile('${repoPath}', '${file}')"
                           ${repoFiles.has(file) ? 'checked' : ''}>
                    ${file}
                </div>
            </div>
        </div>
    `;
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
    switch (message.type) {
        case 'updateChanges':
            currentStatus = message.status;
            updateView();
            break;
    }
});

document.getElementById('commit-message').addEventListener('input', updateCommitButton);
