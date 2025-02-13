const vscode = acquireVsCodeApi();
let selectedFiles = new Map(); // Map<string, Set<string>> - repo -> files
let currentStatus = null;
let expandedNodes = new Set();

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

function updateView() {
    console.log('Updating view with current status:', currentStatus);
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
    console.log('View updated');
    
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

function createRootNode(id, label, children) {
    console.log(`Creating root node: id=${id}, label=${label}`);
    return `
        <div class="tree-node">
            <div class="tree-content root-node">
                <span id="toggle-${id}" class="tree-toggle codicon codicon-chevron-right" onclick="toggleNode('${id}')"></span>
                <input type="checkbox" onchange="toggleAllInSection('${id}')" class="section-checkbox">
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
                <span id="toggle-${repoId}" class="tree-toggle codicon codicon-chevron-right" onclick="toggleNode('${repoId}')"></span>
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
