// Remove Node.js path import and use browser-compatible path handling
function joinPath() {
    var parts = [];
    for (var _i = 0; _i < arguments.length; _i++) {
        parts[_i] = arguments[_i];
    }
    return parts.join('/').replace(/\/+/g, '/');
}
var vscode = acquireVsCodeApi();
var currentStatus = null;
var currentFilesBySection = {};
var selectedFiles = new Set();
var expandedNodes = new Set();
var focusedNodeId = null;
var isTreeView = true;
// Debug environment flag
var isDebugEnv = window.location.hostname === 'localhost';
function log(message, type) {
    if (type === void 0) { type = 'info'; }
    var args = [];
    for (var _i = 2; _i < arguments.length; _i++) {
        args[_i - 2] = arguments[_i];
    }
    // Ignore messages containing 'hello'
    if (message.toLowerCase().includes('hello')) {
        return;
    }
    // Format message with additional args
    var fullMessage = (args === null || args === void 0 ? void 0 : args.length) > 0 ? "".concat(message, " ").concat(args === null || args === void 0 ? void 0 : args.map(function (arg) {
        return typeof arg === 'object' ? JSON.stringify(arg) : arg;
    }).join(' ')) : message;
    // Log to console
    console.log("[".concat(type === null || type === void 0 ? void 0 : type.toUpperCase(), "] ").concat(fullMessage));
    // Show debug message block if in debug environment
    if (isDebugEnv) {
        var debugContainer = document.getElementById('debug-messages') || (function () {
            var container = document.createElement('div');
            container.id = 'debug-messages';
            container.style.cssText = "\n                position: fixed;\n                bottom: 0;\n                right: 0;\n                max-width: 50%;\n                max-height: 200px;\n                overflow-y: auto;\n                background: rgba(0, 0, 0, 0.8);\n                color: #fff;\n                font-family: monospace;\n                font-size: 12px;\n                padding: 10px;\n                z-index: 9999;\n                border-top-left-radius: 4px;\n            ";
            document.body.appendChild(container);
            return container;
        })();
        var messageDiv = document.createElement('div');
        messageDiv.style.cssText = "\n            padding: 4px 8px;\n            margin: 2px 0;\n            border-left: 3px solid ".concat(type === 'error' ? '#ff4444' : type === 'success' ? '#44ff44' : '#4444ff', ";\n            word-wrap: break-word;\n        ");
        messageDiv.textContent = "[".concat(new Date().toLocaleTimeString(), "] ").concat(fullMessage);
        debugContainer.appendChild(messageDiv);
        // Keep only last 50 messages
        while (debugContainer.children.length > 50) {
            debugContainer.removeChild(debugContainer.firstChild);
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
    var statusDiv = document.getElementById('status-message');
    if (statusDiv) {
        statusDiv.textContent = 'Loading changes...';
        statusDiv.style.color = '#666';
    }
    vscode.postMessage({ type: 'refresh' });
}
// Call initialize when DOM is loaded
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
}
else {
    initialize();
}
// Handle messages from the extension
window.addEventListener('message', function (event) {
    var message = event.data;
    log('Received message: ' + JSON.stringify(message));
    try {
        switch (message.type || message.command) {
            case 'updateChanges':
                log('Received updateChanges message: ' + JSON.stringify(message));
                if (message.status) {
                    currentStatus = message.status;
                    updateView();
                }
                else {
                    log('No status data in updateChanges message', 'error');
                    var statusDiv = document.getElementById('status-message');
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
                }
                else {
                    log('No status data in update/updateStatus message', 'error');
                }
                break;
            case 'updateFiles':
                log('Received updateFiles message: ' + JSON.stringify(message));
                var repoPath = message.repoPath, files = message.files, section = message.section;
                if (repoPath && files && section) {
                    var repoKey = getRepoKey(repoPath, section);
                    var fileTree = createFileTree(files);
                    currentFilesBySection[repoKey] = fileTree;
                    updateView();
                }
                break;
            case 'commitSuccess':
                log('Changes committed successfully', 'success');
                updateStatusMessage('Changes committed successfully', 'success');
                showPushPrompt();
                var commitInput = document.getElementById('commit-message');
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
    }
    catch (error) {
        log('Error handling message: ' + error, 'error');
        var statusDiv = document.getElementById('status-message');
        if (statusDiv) {
            statusDiv.textContent = 'Error: ' + error;
            statusDiv.style.color = 'var(--vscode-errorForeground)';
        }
    }
});
// Call initialize when the document is ready
document.addEventListener('DOMContentLoaded', function () {
    log('DOM loaded, setting up view...');
    var root = document.getElementById('tree-root');
    if (!root) {
        log('Could not find tree-root element', 'error');
        return;
    }
    // Show loading state
    root.innerHTML = '<div class="empty-message">Loading changes...</div>';
    // Initialize the view
    initialize();
    // Set up event listeners
    var commitButton = document.getElementById('commit-button');
    if (commitButton) {
        commitButton.addEventListener('click', handleCommit);
    }
    var commitMessage = document.getElementById('commit-message');
    if (commitMessage) {
        commitMessage.addEventListener('input', updateCommitButton);
    }
});
function updateView() {
    log('Updating view with status: ' + JSON.stringify(currentStatus));
    var root = document.getElementById('tree-root');
    var statusMessage = document.getElementById('status-message');
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
    var repos = currentStatus.repositories;
    log('Processing repositories: ' + Object.keys(repos).join(', '));
    // Handle versioned files
    var versionedRepos = Object.entries(repos)
        .filter(function (_a) {
        var _ = _a[0], status = _a[1];
        return status.versioned && status.versioned.length > 0;
    });
    if (versionedRepos.length > 0) {
        log('Creating tracking section for repos: ' + versionedRepos.map(function (_a) {
            var repo = _a[0];
            return repo;
        }).join(', '));
        var _a = createSectionNode('tracking', 'Tracking'), sectionNode = _a.sectionNode, childrenDiv_1 = _a.childrenDiv;
        versionedRepos.forEach(function (_a) {
            var repoPath = _a[0], status = _a[1];
            var fileTree = createFileTree(status.versioned);
            currentFilesBySection[getRepoKey(repoPath, 'tracking')] = fileTree;
            var repoNode = createRepoNode(repoPath, fileTree, 'tracking');
            childrenDiv_1.appendChild(repoNode);
        });
        root.appendChild(sectionNode);
    }
    // Handle unversioned files
    var unversionedRepos = Object.entries(repos)
        .filter(function (_a) {
        var _ = _a[0], status = _a[1];
        return status.unversioned && status.unversioned.length > 0;
    });
    if (unversionedRepos.length > 0) {
        log('Creating unversioned section for repos: ' + unversionedRepos.map(function (_a) {
            var repo = _a[0];
            return repo;
        }).join(', '));
        var _b = createSectionNode('unversioned', 'Unversioned'), sectionNode = _b.sectionNode, childrenDiv_2 = _b.childrenDiv;
        unversionedRepos.forEach(function (_a) {
            var repoPath = _a[0], status = _a[1];
            var fileTree = createFileTree(status.unversioned);
            currentFilesBySection[getRepoKey(repoPath, 'unversioned')] = fileTree;
            var repoNode = createRepoNode(repoPath, fileTree, 'unversioned');
            childrenDiv_2.appendChild(repoNode);
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
    expandedNodes.forEach(function (nodeId) {
        var childrenElement = document.getElementById("children-".concat(nodeId));
        var toggleElement = document.getElementById("toggle-".concat(nodeId));
        if (childrenElement && toggleElement) {
            childrenElement.style.display = 'block';
            toggleElement.className = 'tree-toggle codicon codicon-chevron-down';
        }
    });
}
function refreshChanges() {
    vscode.postMessage({ type: 'refresh' });
}
function toggleNode(nodeId) {
    log("Toggling node: ".concat(nodeId));
    var childrenElement = document.getElementById("children-".concat(nodeId));
    var toggleElement = document.getElementById("toggle-".concat(nodeId));
    if (childrenElement && toggleElement) {
        var isExpanded = expandedNodes.has(nodeId);
        if (isExpanded) {
            log("Collapsing node: ".concat(nodeId));
            childrenElement.style.display = 'none';
            toggleElement.classList.remove('codicon-chevron-down');
            toggleElement.classList.add('codicon-chevron-right');
            expandedNodes.delete(nodeId);
        }
        else {
            log("Expanding node: ".concat(nodeId));
            childrenElement.style.display = 'block';
            toggleElement.classList.remove('codicon-chevron-right');
            toggleElement.classList.add('codicon-chevron-down');
            expandedNodes.add(nodeId);
        }
    }
}
function getFileKey(repoPath, section, file) {
    return "".concat(repoPath, ":").concat(section, ":").concat(file);
}
function getRepoKey(repoPath, section) {
    return "".concat(repoPath, ":").concat(section);
}
function updateParentDirectoryCheckboxes(repoPath, dirPath, section, direction) {
    if (direction === void 0) { direction = "down" /* DirectionTypes.Down */; }
    // Get all checkboxes for this repo and section
    var allCheckboxes = Array.from(document.querySelectorAll("input[type=\"checkbox\"][data-repo=\"".concat(repoPath, "\"][data-section=\"").concat(section, "\"]")));
    // Get all file checkboxes
    var fileCheckboxes = allCheckboxes.filter(function (cb) { return cb.dataset.file; });
    // For each directory level in the path, update its checkbox state
    var pathParts = dirPath.split('/');
    var _loop_1 = function (i) {
        var currentPath = pathParts.slice(0, i).join('/');
        if (!currentPath)
            return "continue";
        var dirCheckbox = document.querySelector("input[type=\"checkbox\"][data-repo=\"".concat(repoPath, "\"][data-dir=\"").concat(currentPath, "\"][data-section=\"").concat(section, "\"]"));
        if (dirCheckbox) {
            // Get all files under this directory
            var filesUnderDir = fileCheckboxes.filter(function (cb) {
                var filePath = cb.dataset.file;
                return filePath && (filePath === currentPath || // Exact match
                    filePath.startsWith(currentPath + '/') // Under this directory
                );
            });
            if (filesUnderDir.length > 0) {
                var allChecked = filesUnderDir.every(function (cb) { return cb.checked; });
                var someChecked = filesUnderDir.some(function (cb) { return cb.checked; });
                dirCheckbox.checked = allChecked;
                dirCheckbox.indeterminate = !allChecked && someChecked;
            }
        }
    };
    for (var i = 1; i <= pathParts.length; i++) {
        _loop_1(i);
    }
    if (direction === "up" /* DirectionTypes.Up */) {
        updateRepoCheckbox(repoPath, section, "up" /* DirectionTypes.Up */);
    }
    //updateRepoCheckbox(repoPath, section, DirectionTypes.Up);
}
function toggleSection(sectionId, isChecked) {
    var section = document.getElementById(sectionId);
    if (!section)
        return;
    var fileCheckboxes = section.querySelectorAll('input[type="checkbox"][data-repo]');
    var processedRepos = new Set();
    fileCheckboxes.forEach(function (checkbox) {
        var repoPath = checkbox.dataset.repo;
        if (repoPath && !processedRepos.has(repoPath)) {
            processedRepos.add(repoPath);
            var fileTree = currentFilesBySection[getRepoKey(repoPath, sectionId)];
            if (fileTree) {
                var allFiles = getAllFilesUnderTree(fileTree);
                allFiles.forEach(function (file) {
                    if (isChecked) {
                        selectedFiles.add(getFileKey(repoPath, sectionId, file));
                    }
                    else {
                        selectedFiles.delete(getFileKey(repoPath, sectionId, file));
                    }
                });
            }
        }
    });
    var sectionCheckbox = document.getElementById("".concat(sectionId, "-checkbox"));
    if (sectionCheckbox) {
        sectionCheckbox.checked = isChecked;
        sectionCheckbox.indeterminate = false;
    }
    //updateSectionCheckboxStates();
    //updateView();
}
function createSectionNode(sectionId, title) {
    log('Creating section node', 'info', sectionId, title);
    var sectionNode = document.createElement('div');
    sectionNode.className = "section ".concat(sectionId, "-section");
    sectionNode.id = sectionId;
    sectionNode.dataset.section = sectionId;
    var titleDiv = document.createElement('div');
    titleDiv.className = 'section-title';
    var toggleSpan = document.createElement('span');
    toggleSpan.className = 'codicon codicon-chevron-down';
    titleDiv.appendChild(toggleSpan);
    var checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'section-checkbox';
    checkbox.id = "".concat(sectionId, "-checkbox");
    checkbox.dataset.section = sectionId;
    checkbox.addEventListener('change', function () { return toggleSection(sectionId, checkbox.checked); });
    titleDiv.appendChild(checkbox);
    var titleSpan = document.createElement('span');
    titleSpan.textContent = title;
    titleDiv.appendChild(titleSpan);
    sectionNode.appendChild(titleDiv);
    var childrenDiv = document.createElement('div');
    childrenDiv.className = 'section-content';
    sectionNode.appendChild(childrenDiv);
    log('Created section node', 'info', sectionNode);
    return { sectionNode: sectionNode, childrenDiv: childrenDiv };
}
function toggleDirectoryFiles(repoPath, dirPath, checked, section) {
    log("Toggling directory ".concat(dirPath, " in repo ").concat(repoPath, " to ").concat(checked));
    // Get all checkboxes under this directory
    var dirSelector = "[data-repo=\"".concat(repoPath, "\"][data-section=\"").concat(section, "\"]");
    var allCheckboxes = document.querySelectorAll("input[type=\"checkbox\"]".concat(dirSelector));
    // First update all immediate children
    allCheckboxes.forEach(function (checkbox) {
        var checkboxDir = checkbox.dataset.dir;
        var checkboxFile = checkbox.dataset.file;
        if (checkboxDir === dirPath) {
            // This is the directory checkbox itself
            checkbox.checked = checked;
            checkbox.indeterminate = false;
        }
        else if (checkboxFile && checkboxFile.startsWith(dirPath + '/') &&
            !checkboxFile.slice(dirPath.length + 1).includes('/')) {
            // This is an immediate file child
            checkbox.checked = checked;
            if (checked) {
                selectFile(repoPath, checkboxFile, section);
            }
            else {
                unselectFile(repoPath, checkboxFile, section);
            }
        }
        else if (checkboxDir && checkboxDir.startsWith(dirPath + '/') &&
            !checkboxDir.slice(dirPath.length + 1).includes('/')) {
            // This is an immediate directory child
            checkbox.checked = checked;
            checkbox.indeterminate = false;
            // Recursively update this directory's children
            toggleDirectoryFiles(repoPath, checkboxDir, checked, section);
        }
    });
    // Update parent directory states
    var parentPath = dirPath.split('/').slice(0, -1).join('/');
    while (parentPath) {
        var parentCheckbox = document.querySelector("input[type=\"checkbox\"][data-repo=\"".concat(repoPath, "\"][data-dir=\"").concat(parentPath, "\"][data-section=\"").concat(section, "\"]"));
        if (parentCheckbox) {
            // Get all immediate children of this parent
            var immediateChildren = Array.from(allCheckboxes).filter(function (checkbox) {
                var childDir = checkbox.dataset.dir;
                var childFile = checkbox.dataset.file;
                var path = childDir || childFile;
                if (!path)
                    return false;
                // Check if it's an immediate child
                var relativePath = path.slice(parentPath.length + 1);
                return path.startsWith(parentPath + '/') && !relativePath.includes('/');
            });
            // Check children states
            var allChecked = immediateChildren.every(function (c) { return c.checked; });
            var allUnchecked = immediateChildren.every(function (c) { return !c.checked && !c.indeterminate; });
            if (allChecked) {
                parentCheckbox.checked = true;
                parentCheckbox.indeterminate = false;
            }
            else if (allUnchecked) {
                parentCheckbox.checked = false;
                parentCheckbox.indeterminate = false;
            }
            else {
                parentCheckbox.checked = false;
                parentCheckbox.indeterminate = true;
            }
        }
        parentPath = parentPath.split('/').slice(0, -1).join('/');
    }
    // Update section checkbox state
    //updateSectionCheckboxStates();
    // Update commit button state
    updateCommitButton();
}
function createFileTree(files) {
    var tree = { _files: [] };
    files.forEach(function (file) {
        var parts = file.split('/');
        var currentNode = tree;
        var currentPath = '';
        // Handle each directory in the path
        for (var i = 0; i < parts.length - 1; i++) {
            var part = parts[i];
            if (!part)
                continue;
            currentPath = currentPath ? "".concat(currentPath, "/").concat(part) : part;
            if (!(part in currentNode)) {
                currentNode[part] = { _files: [] };
            }
            currentNode = currentNode[part];
        }
        // Add the file to the final directory's _files array
        var fileName = parts[parts.length - 1];
        if (fileName) {
            currentNode._files.push(file); // Store full path
        }
    });
    return tree;
}
function createRepoNode(repoPath, fileTree, section) {
    log("Creating repo node for ".concat(repoPath, " in section ").concat(section));
    var repoNode = document.createElement('div');
    repoNode.className = 'tree-node repo-node';
    repoNode.dataset.repo = repoPath;
    repoNode.dataset.section = section;
    var contentDiv = document.createElement('div');
    contentDiv.className = 'tree-content';
    var toggleSpan = document.createElement('span');
    toggleSpan.className = 'tree-toggle codicon codicon-chevron-right';
    contentDiv.appendChild(toggleSpan);
    var checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'tree-checkbox';
    checkbox.dataset.repo = repoPath;
    checkbox.dataset.section = section;
    checkbox.addEventListener('change', function () { return handleRepoCheckboxToggle(repoPath, checkbox.checked, section); });
    contentDiv.appendChild(checkbox);
    var iconSpan = document.createElement('span');
    iconSpan.className = 'codicon codicon-git-branch';
    contentDiv.appendChild(iconSpan);
    var label = document.createElement('span');
    label.className = 'tree-label';
    label.textContent = repoPath.split('/').pop() || repoPath; // Show only the repo name
    contentDiv.appendChild(label);
    repoNode.appendChild(contentDiv);
    var childrenDiv = document.createElement('div');
    childrenDiv.className = 'tree-children';
    repoNode.appendChild(childrenDiv);
    // Add click handler to toggle children
    contentDiv.addEventListener('click', function (e) {
        if (e.target === checkbox)
            return; // Don't toggle on checkbox click
        childrenDiv.classList.toggle('expanded');
        toggleSpan.classList.toggle('codicon-chevron-right');
        toggleSpan.classList.toggle('codicon-chevron-down');
    });
    // Create root level file nodes
    var rootFiles = fileTree._files || [];
    rootFiles.forEach(function (file) {
        if (!file.includes('/')) {
            childrenDiv.appendChild(createFileNode(repoPath, file, section));
        }
    });
    // Create directory nodes
    Object.entries(fileTree)
        .filter(function (_a) {
        var key = _a[0];
        return key !== '_files';
    })
        .forEach(function (_a) {
        var key = _a[0], value = _a[1];
        childrenDiv.appendChild(createDirectoryNode(repoPath, key, value, section));
    });
    return repoNode;
}
function toggleAllFiles(repoPath, section) {
    var repoKey = getRepoKey(repoPath, section);
    var fileTree = currentFilesBySection[repoKey];
    if (!fileTree)
        return;
    var allFiles = getAllFilesUnderTree(fileTree);
    var allSelected = allFiles.every(function (file) { return selectedFiles.has(getFileKey(repoPath, section, file)); });
    allFiles.forEach(function (file) {
        if (allSelected) {
            selectedFiles.delete(getFileKey(repoPath, section, file));
        }
        else {
            selectedFiles.add(getFileKey(repoPath, section, file));
        }
    });
    updateView();
}
function getAllFilesUnderTree(tree) {
    if (Array.isArray(tree)) {
        return tree;
    }
    if (!tree || typeof tree !== 'object') {
        return [];
    }
    var files = [];
    // Add files from current directory
    if (Array.isArray(tree._files)) {
        files.push.apply(files, tree._files);
    }
    // Add files from subdirectories
    Object.entries(tree).forEach(function (_a) {
        var key = _a[0], subtree = _a[1];
        if (key !== '_files' && typeof subtree === 'object') {
            var subFiles = getAllFilesUnderTree(subtree);
            files.push.apply(files, subFiles);
        }
    });
    return files;
}
function getSubtreeFromPath(tree, path) {
    if (!path)
        return tree;
    var parts = path.split('/');
    var current = tree;
    for (var _i = 0, parts_1 = parts; _i < parts_1.length; _i++) {
        var part = parts_1[_i];
        if (!current || !current[part] || Array.isArray(current[part]))
            return null;
        current = current[part];
    }
    return current;
}
function updateCommitButton() {
    var commitButton = document.getElementById('commit-button');
    var commitMessage = document.getElementById('commit-message');
    log('[updateCommitButton] Selected files', 'info', Array.from(selectedFiles));
    if (!commitButton || !commitMessage)
        return;
    var hasMessage = commitMessage.value.trim().length > 0;
    var hasFiles = selectedFiles.size > 0;
    commitButton.disabled = !hasMessage || !hasFiles;
}
function getSelectedPaths() {
    log('[getSelectedPaths] Getting selected paths...');
    var selectedPaths = [];
    selectedFiles.forEach(function (fileKey) {
        var _a = fileKey.split(':'), repoPath = _a[0], section = _a[1], filePath = _a[2];
        log("[getSelectedPaths] Adding file: ".concat(filePath, " from repo: ").concat(repoPath));
        selectedPaths.push({
            path: filePath,
            repo: repoPath
        });
    });
    log('[getSelectedPaths] Final selected paths', 'info', selectedPaths);
    return selectedPaths;
}
function handleCommit() {
    log('[handleCommit] Starting commit...');
    var commitMessage = document.getElementById('commit-message').value;
    log('[handleCommit] Commit message', 'info', commitMessage);
    var selectedPaths = [];
    selectedFiles.forEach(function (fileKey) {
        var _a = fileKey.split(':'), repoPath = _a[0], section = _a[1], filePath = _a[2];
        selectedPaths.push({ path: filePath, repo: repoPath, section: section });
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
function toggleNodeSelection(nodeId) {
    var node = document.getElementById(nodeId);
    if (!node)
        return;
    var checkbox = node.querySelector('input[type="checkbox"]');
    if (checkbox) {
        checkbox.checked = !checkbox.checked;
        checkbox.dispatchEvent(new Event('change'));
    }
}
function getNextVisibleNode(currentNode, direction) {
    var _a, _b;
    if (!currentNode)
        return null;
    if (direction === 'down') {
        // First try to find the first child
        var childrenDiv = currentNode.querySelector('.section-children');
        if (childrenDiv && childrenDiv.style.display !== 'none') {
            var firstChild = childrenDiv.querySelector('.tree-node, .section');
            if (firstChild)
                return firstChild;
        }
        // If no child found, try to find the next sibling
        var nextNode = currentNode;
        while (nextNode) {
            var nextSibling = nextNode.nextElementSibling;
            if (nextSibling)
                return nextSibling;
            // If no sibling found, move up to parent and try again
            var parentElement = (_a = nextNode.parentElement) === null || _a === void 0 ? void 0 : _a.closest('.tree-node, .section');
            if (!parentElement)
                return null;
            nextNode = parentElement;
        }
    }
    else {
        // First try to find the previous sibling's last visible child
        var prevSibling = currentNode.previousElementSibling;
        if (prevSibling) {
            var childrenDiv = prevSibling.querySelector('.section-children');
            if (childrenDiv && childrenDiv.style.display !== 'none') {
                var lastChild = Array.from(childrenDiv.querySelectorAll('.tree-node')).pop();
                if (lastChild)
                    return lastChild;
            }
            return prevSibling;
        }
        // If no previous sibling, return the parent
        return (_b = currentNode.parentElement) === null || _b === void 0 ? void 0 : _b.closest('.tree-node, .section');
    }
    return null;
}
function focusNode(node) {
    if (focusedNodeId) {
        var prevNode = document.getElementById(focusedNodeId);
        if (prevNode) {
            prevNode.blur();
        }
    }
    focusedNodeId = node.id;
    node.focus();
    node.scrollIntoView({ block: 'nearest' });
}
function isTreeNode(element) {
    return element !== null && element.classList.contains('tree-node');
}
function addClickHandler(node) {
    var contentDiv = node.querySelector('.tree-content, .section-title');
    if (contentDiv) {
        contentDiv.addEventListener('click', function (event) {
            var target = event.target;
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
function selectFile(repoPath, file, section) {
    var fileKey = getFileKey(repoPath, section, file);
    selectedFiles.add(fileKey);
}
function unselectFile(repoPath, file, section) {
    var fileKey = getFileKey(repoPath, section, file);
    selectedFiles.delete(fileKey);
}
function isFileSelected(repoPath, file, section) {
    var fileKey = getFileKey(repoPath, section, file);
    return selectedFiles.has(fileKey);
}
function updateRepoCheckbox(repoPath, section, direction) {
    if (direction === void 0) { direction = "up" /* DirectionTypes.Up */; }
    log("[updateRepoCheckbox] Updating repo checkbox for ".concat(repoPath, ", section: ").concat(section));
    var sectionDiv = document.querySelector(".".concat(section, "-section"));
    if (!sectionDiv)
        return;
    var checkbox = sectionDiv.querySelector("input[type=\"checkbox\"][data-repo=\"".concat(repoPath, "\"][data-section=\"").concat(section, "\"]"));
    if (!checkbox)
        return;
    var fileTree = currentFilesBySection[getRepoKey(repoPath, section)];
    if (!fileTree) {
        log("[updateRepoCheckbox] No file tree found for repo");
        return;
    }
    var allFiles = getAllFilesUnderTree(fileTree);
    log("[updateRepoCheckbox] All files", 'info', allFiles);
    var allSelected = allFiles.every(function (file) { return isFileSelected(repoPath, file, section); });
    var someSelected = allFiles.some(function (file) { return isFileSelected(repoPath, file, section); });
    log("[updateRepoCheckbox] Files status - all: ".concat(allSelected, ", some: ").concat(someSelected));
    checkbox.checked = allSelected;
    checkbox.indeterminate = !allSelected && someSelected;
    if (direction === "up" /* DirectionTypes.Up */) {
        updateSectionCheckboxStates();
    }
}
function showPushPrompt() {
    var _a, _b;
    var pushPrompt = document.createElement('div');
    pushPrompt.className = 'push-prompt';
    pushPrompt.innerHTML = "\n        <div class=\"push-prompt-content\">\n            <p>Would you like to push your changes?</p>\n            <div class=\"push-prompt-buttons\">\n                <button id=\"push-yes\" class=\"push-button\">Yes</button>\n                <button id=\"push-no\" class=\"push-button\">No</button>\n            </div>\n        </div>\n    ";
    document.body.appendChild(pushPrompt);
    (_a = document.getElementById('push-yes')) === null || _a === void 0 ? void 0 : _a.addEventListener('click', function () {
        vscode.postMessage({ command: 'push' });
        pushPrompt.remove();
    });
    (_b = document.getElementById('push-no')) === null || _b === void 0 ? void 0 : _b.addEventListener('click', function () {
        pushPrompt.remove();
    });
}
function updateStatusMessage(message, type) {
    if (type === void 0) { type = 'success'; }
    var statusArea = document.getElementById('status-message');
    if (!statusArea) {
        statusArea = document.createElement('div');
        statusArea.id = 'status-message';
        var commitButton = document.getElementById('commit-button');
        if (commitButton) {
            commitButton.insertAdjacentElement('afterend', statusArea);
        }
    }
    statusArea.textContent = message;
    statusArea.className = "status-message ".concat(type);
    if (type === 'success') {
        setTimeout(function () {
            if (statusArea) {
                statusArea.textContent = '';
                statusArea.className = 'status-message';
            }
        }, 5000);
    }
}
function createDirectoryNode(repoPath, dirPath, fileTree, section) {
    var dirNode = document.createElement('div');
    dirNode.className = 'tree-node directory-node';
    dirNode.dataset.repo = repoPath;
    dirNode.dataset.dir = dirPath;
    dirNode.dataset.section = section;
    var contentDiv = document.createElement('div');
    contentDiv.className = 'tree-content';
    var toggleSpan = document.createElement('span');
    toggleSpan.className = 'tree-toggle codicon codicon-chevron-right';
    contentDiv.appendChild(toggleSpan);
    var checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'tree-checkbox';
    checkbox.dataset.repo = repoPath;
    checkbox.dataset.dir = dirPath;
    checkbox.dataset.section = section;
    checkbox.addEventListener('change', function () {
        toggleDirectoryFiles(repoPath, dirPath, checkbox.checked, section);
        updateParentDirectoryCheckboxes(repoPath, dirPath, section, "up" /* DirectionTypes.Up */);
        //updateRepoCheckbox(repoPath, section);
        updateCommitButton();
    });
    contentDiv.appendChild(checkbox);
    var iconSpan = document.createElement('span');
    iconSpan.className = 'codicon codicon-folder';
    contentDiv.appendChild(iconSpan);
    var label = document.createElement('span');
    label.className = 'tree-label';
    label.textContent = dirPath.split('/').pop() || '';
    contentDiv.appendChild(label);
    dirNode.appendChild(contentDiv);
    var childrenDiv = document.createElement('div');
    childrenDiv.className = 'tree-children';
    dirNode.appendChild(childrenDiv);
    // Add click handler to toggle children
    contentDiv.addEventListener('click', function (e) {
        if (e.target === checkbox)
            return;
        childrenDiv.classList.toggle('expanded');
        toggleSpan.classList.toggle('codicon-chevron-right');
        toggleSpan.classList.toggle('codicon-chevron-down');
    });
    // Create file nodes for files in this directory
    var filesInDir = fileTree._files || [];
    filesInDir.forEach(function (file) {
        if (file) {
            childrenDiv.appendChild(createFileNode(repoPath, file, section));
        }
    });
    // Create directory nodes for subdirectories
    Object.entries(fileTree)
        .filter(function (_a) {
        var key = _a[0];
        return key !== '_files';
    })
        .forEach(function (_a) {
        var key = _a[0], value = _a[1];
        var fullPath = "".concat(dirPath, "/").concat(key);
        childrenDiv.appendChild(createDirectoryNode(repoPath, fullPath, value, section));
    });
    return dirNode;
}
function createFileNode(repoPath, file, section) {
    log("Creating file node for ".concat(file, " in repo ").concat(repoPath));
    var fileNode = document.createElement('div');
    fileNode.className = 'tree-node file-node';
    fileNode.dataset.repo = repoPath;
    fileNode.dataset.file = file;
    fileNode.dataset.section = section;
    var contentDiv = document.createElement('div');
    contentDiv.className = 'tree-content';
    var checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'tree-checkbox';
    checkbox.dataset.repo = repoPath;
    checkbox.dataset.file = file;
    checkbox.dataset.section = section;
    checkbox.checked = isFileSelected(repoPath, file, section);
    checkbox.addEventListener('change', function () {
        if (checkbox.checked) {
            selectFile(repoPath, file, section);
        }
        else {
            unselectFile(repoPath, file, section);
        }
        var parentDir = file.split('/').slice(0, -1).join('/');
        if (parentDir) {
            updateParentDirectoryCheckboxes(repoPath, parentDir, section, "up" /* DirectionTypes.Up */);
        }
        else {
            updateRepoCheckbox(repoPath, section, "up" /* DirectionTypes.Up */);
        }
        updateCommitButton();
    });
    contentDiv.appendChild(checkbox);
    var iconSpan = document.createElement('span');
    iconSpan.className = 'codicon codicon-file';
    contentDiv.appendChild(iconSpan);
    var label = document.createElement('span');
    label.className = 'tree-label';
    label.textContent = file;
    contentDiv.appendChild(label);
    fileNode.appendChild(contentDiv);
    return fileNode;
}
function handleRepoCheckboxToggle(repoPath, checked, section) {
    toggleNodesUnderRepo(repoPath, checked, section);
    //updateRepoCheckbox(repoPath, section, DirectionTypes.Down);
    updateSectionCheckboxStates();
    /*// Update the repo checkbox state
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
    */
    // Update commit button state
    updateCommitButton();
}
function toggleNodesUnderRepo(repoPath, checked, section) {
    log("Toggling repo ".concat(repoPath, " to ").concat(checked));
    // Get all checkboxes for this repo and section
    var repoSelector = "[data-repo=\"".concat(repoPath, "\"][data-section=\"").concat(section, "\"]");
    var allCheckboxes = document.querySelectorAll(".repo-node[data-repo=\"".concat(repoPath, "\"] input[type=\"checkbox\"][data-section=\"").concat(section, "\"]"));
    // First update all top-level items
    allCheckboxes.forEach(function (checkbox) {
        var checkboxDir = checkbox.dataset.dir;
        var checkboxFile = checkbox.dataset.file;
        // Skip the repo checkbox itself
        if (!checkboxDir && !checkboxFile)
            return;
        // If it's a top-level item (no slashes in path)
        if ((checkboxDir && !checkboxDir.includes('/')) ||
            (checkboxFile && !checkboxFile.includes('/'))) {
            checkbox.checked = checked;
            checkbox.indeterminate = false;
            if (checkboxDir) {
                // Recursively update directory children
                toggleDirectoryFiles(repoPath, checkboxDir, checked, section);
            }
            else if (checkboxFile) {
                // Update file selection
                if (checked) {
                    selectFile(repoPath, checkboxFile, section);
                }
                else {
                    unselectFile(repoPath, checkboxFile, section);
                }
            }
        }
    });
}
function updateSectionCheckboxStates() {
    var sections = ['tracking', 'unversioned'];
    log('Updating section checkbox states', 'info', sections);
    sections.forEach(function (section) {
        log("Checking section: ".concat(section));
        var sectionCheckbox = document.querySelector("input[type=\"checkbox\"].section-checkbox[data-section=\"".concat(section, "\"]"));
        if (sectionCheckbox) {
            log("Found section checkbox for ".concat(section));
            var repoCheckboxes = document.querySelectorAll(".repo-node > .tree-content > input[type=\"checkbox\"][data-section=\"".concat(section, "\"]"));
            log("Found ".concat(repoCheckboxes.length, " repo checkboxes for section ").concat(section));
            if (repoCheckboxes.length > 0) {
                var repoStates = Array.from(repoCheckboxes).map(function (cb) { return ({
                    checked: cb.checked,
                    indeterminate: cb.indeterminate
                }); });
                log("Repo checkbox states for ".concat(section, ":"), 'info', repoStates);
                var allChecked = Array.from(repoCheckboxes).every(function (cb) { return cb.checked; });
                var allUnchecked = Array.from(repoCheckboxes).every(function (cb) { return !cb.checked && !cb.indeterminate; });
                log("Section ".concat(section, " states - allChecked: ").concat(allChecked, ", allUnchecked: ").concat(allUnchecked));
                if (allChecked) {
                    log("Setting ".concat(section, " to checked"));
                    sectionCheckbox.checked = true;
                    sectionCheckbox.indeterminate = false;
                }
                else if (allUnchecked) {
                    log("Setting ".concat(section, " to unchecked"));
                    sectionCheckbox.checked = false;
                    sectionCheckbox.indeterminate = false;
                }
                else {
                    log("Setting ".concat(section, " to indeterminate"));
                    sectionCheckbox.checked = false;
                    sectionCheckbox.indeterminate = true;
                }
            }
            else {
                log("No repo checkboxes found for section ".concat(section, ", setting to unchecked"));
                sectionCheckbox.checked = false;
                sectionCheckbox.indeterminate = false;
            }
        }
        else {
            log("No section checkbox found for ".concat(section), 'error');
        }
    });
}
function printElementInfo(message, element) {
    console.log(message, {
        id: element.id,
        className: element.className,
        dataset: element.dataset,
        tagName: element.tagName
    });
}
function isElementVisible(element) {
    return !!(element.offsetWidth || element.offsetHeight || element.getClientRects().length);
}
document.addEventListener('keydown', function (event) {
    if (event.key === 'Tab' || event.key === 'ArrowDown') {
        var activeElement = document.activeElement;
        if (activeElement) {
            console.log('Active element attributes:' + event.key, {
                id: activeElement.id,
                className: activeElement.className,
                dataset: activeElement.dataset,
                tagName: activeElement.tagName
            });
        }
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            activeElement === null || activeElement === void 0 ? void 0 : activeElement.blur();
            var tabEvent = new KeyboardEvent('keydown', {
                bubbles: true,
                cancelable: true,
                key: 'Tab',
                code: 'Tab',
                keyCode: 9,
                which: 9,
                composed: true
            });
            activeElement === null || activeElement === void 0 ? void 0 : activeElement.dispatchEvent(tabEvent);
            document.dispatchEvent(tabEvent);
        }
    }
});
