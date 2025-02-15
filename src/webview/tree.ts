import {
    provideVSCodeDesignSystem,
    vsCodeCheckbox,
    Button
} from '@vscode/webview-ui-toolkit';

// Declare VS Code API
declare function acquireVsCodeApi(): {
    postMessage: (message: any) => void;
    getState: () => any;
    setState: (state: any) => void;
};

// Initialize VS Code API or mock for development
const vscode = (function() {
    if (typeof acquireVsCodeApi === 'function') {
        return acquireVsCodeApi();
    }
    // Mock implementation for development
    return {
        postMessage: (message: any) => {
            console.log('Development mode: VS Code message', message);
        },
        getState: () => null,
        setState: (state: any) => {
            console.log('Development mode: VS Code state', state);
        }
    };
})();

// Register VS Code design system
provideVSCodeDesignSystem().register(
    vsCodeCheckbox()
);

interface GitStatus {
    repositories: {
        [key: string]: {
            versioned: string[];
            unversioned: string[];
        };
    };
}

interface TreeNode {
    id: string;
    label: string;
    type: 'file' | 'directory' | 'repo';
    checked: boolean;
    indeterminate?: boolean;
    children?: TreeNode[];
    path: string;
    repo?: string;
    section?: 'tracking' | 'unversioned';
}

let currentStatus: GitStatus | null = null;

function createTreeNode(
    path: string,
    type: 'file' | 'directory' | 'repo',
    repo?: string,
    section?: 'tracking' | 'unversioned'
): TreeNode {
    const label = path.split('/').pop() || path;
    return {
        id: `${repo || ''}:${path}:${section || ''}`,
        label,
        type,
        checked: false,
        path,
        repo,
        section,
        children: type !== 'file' ? [] : undefined
    };
}

function buildFileTree(files: string[], repo: string, section: 'tracking' | 'unversioned'): TreeNode {
    const root: TreeNode = createTreeNode(repo, 'repo', repo, section);
    const pathMap = new Map<string, TreeNode>();
    pathMap.set('', root);

    files.sort().forEach(filePath => {
        const parts = filePath.split('/');
        let currentPath = '';
        
        // Create or get each directory in the path
        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            const parentPath = currentPath;
            currentPath = currentPath ? `${currentPath}/${part}` : part;
            
            if (!pathMap.has(currentPath)) {
                const isFile = i === parts.length - 1;
                const node = createTreeNode(
                    currentPath,
                    isFile ? 'file' : 'directory',
                    repo,
                    section
                );
                node.label = part; // Use just the directory/file name, not full path
                
                const parent = pathMap.get(parentPath)!;
                if (!parent.children) parent.children = [];
                parent.children.push(node);
                pathMap.set(currentPath, node);
            }
        }
    });

    return root;
}

function renderTree(node: TreeNode, parentElement: HTMLElement) {
    const treeItem = document.createElement('div');
    treeItem.className = 'tree-item';
    treeItem.id = `${node.repo}:${node.path}:${node.type}`;
    treeItem.setAttribute('role', 'treeitem');
    treeItem.setAttribute('tabindex', '0');
    treeItem.setAttribute('data-type', node.type);
    
    // Create container for checkbox and label
    const contentContainer = document.createElement('div');
    contentContainer.className = 'tree-item-content';
    
    // Add expand/collapse indicator for directories
    if (node.type === 'directory' || node.type === 'repo') {
        const expandIcon = document.createElement('span');
        expandIcon.className = 'expand-icon';
        expandIcon.textContent = '▶';
        contentContainer.appendChild(expandIcon);
    }
    
    // Add checkbox
    const checkbox = document.createElement('vscode-checkbox') as HTMLElement & { checked: boolean; indeterminate: boolean };
    checkbox.checked = node.checked;
    checkbox.indeterminate = node.indeterminate || false;
    checkbox.addEventListener('change', (e) => {
        e.stopPropagation(); // Prevent event from bubbling to tree-item click
        const target = e.target as HTMLInputElement;
        handleCheckboxChange(node, target.checked);
    });
    
    // Add label
    const label = document.createElement('span');
    label.className = 'tree-label';
    label.textContent = node.label;
    
    contentContainer.appendChild(checkbox);
    contentContainer.appendChild(label);
    treeItem.appendChild(contentContainer);
    
    // Handle click for expand/collapse
    if (node.children?.length) {
        treeItem.addEventListener('click', (e) => {
            // Stop event from bubbling up to parent nodes
            e.stopPropagation();
            
            // Don't toggle if clicking checkbox
            if ((e.target as HTMLElement).closest('vscode-checkbox')) {
                return;
            }
            
            const childContainer = treeItem.querySelector('.tree-children');
            const expandIcon = treeItem.querySelector('.expand-icon');
            if (childContainer) {
                const isHidden = childContainer.classList.contains('hidden');
                childContainer.classList.toggle('hidden');
                if (expandIcon) {
                    expandIcon.textContent = isHidden ? '▼' : '▶';
                    expandIcon.classList.toggle('expanded', isHidden);
                }
            }
        });
    }
    
    // Handle keyboard navigation
    treeItem.addEventListener('keydown', (e) => {
        switch (e.key) {
            case ' ':
            case 'Enter':
                e.preventDefault();
                // If pressing space/enter on a directory, toggle expand/collapse
                if (node.children?.length) {
                    treeItem.click();
                } else {
                    checkbox.click();
                }
                break;
            case 'ArrowRight':
                e.preventDefault();
                if (node.children?.length) {
                    const childContainer = treeItem.querySelector('.tree-children');
                    const expandIcon = treeItem.querySelector('.expand-icon');
                    if (childContainer?.classList.contains('hidden')) {
                        childContainer.classList.remove('hidden');
                        if (expandIcon) {
                            expandIcon.textContent = '▼';
                            expandIcon.classList.add('expanded');
                        }
                        const firstChild = childContainer.querySelector('.tree-item');
                        if (firstChild instanceof HTMLElement) {
                            firstChild.focus();
                        }
                    }
                }
                break;
            case 'ArrowLeft':
                e.preventDefault();
                if (node.children?.length) {
                    const childContainer = treeItem.querySelector('.tree-children');
                    const expandIcon = treeItem.querySelector('.expand-icon');
                    if (childContainer && !childContainer.classList.contains('hidden')) {
                        childContainer.classList.add('hidden');
                        if (expandIcon) {
                            expandIcon.textContent = '▶';
                            expandIcon.classList.remove('expanded');
                        }
                    }
                }
                treeItem.focus();
                break;
            case 'ArrowDown':
                e.preventDefault();
                const next = treeItem.nextElementSibling as HTMLElement;
                if (next) next.focus();
                break;
            case 'ArrowUp':
                e.preventDefault();
                const prev = treeItem.previousElementSibling as HTMLElement;
                if (prev) prev.focus();
                break;
        }
    });
    
    if (node.children?.length) {
        const childContainer = document.createElement('div');
        childContainer.className = 'tree-children hidden'; // Start collapsed
        node.children.forEach(child => renderTree(child, childContainer));
        treeItem.appendChild(childContainer);
    }
    
    parentElement.appendChild(treeItem);
}

function handleCheckboxChange(node: TreeNode, checked: boolean) {
    node.checked = checked;
    node.indeterminate = false;
    
    // Update children
    if (node.children) {
        node.children.forEach(child => {
            handleCheckboxChange(child, checked);
        });
    }
    
    // Update parent states
    updateParentStates();
    
    // Notify extension
    vscode.postMessage({
        type: 'selectionChanged',
        selection: getSelectedFiles()
    });
}

function updateParentStates() {
    const sections: ('tracking' | 'unversioned')[] = ['tracking', 'unversioned'];
    
    sections.forEach(section => {
        const tree = document.getElementById(`${section}-tree`);
        if (!tree) return;
        
        const items = tree.querySelectorAll('.tree-item');
        items.forEach(item => {
            const children = Array.from(item.querySelectorAll(':scope > .tree-children > .tree-item'));
            if (children.length === 0) return;
            
            const checkbox = item.querySelector('vscode-checkbox') as HTMLElement & { checked: boolean; indeterminate: boolean };
            if (!checkbox) return;
            
            const childCheckboxes = children.map(child => 
                child.querySelector('vscode-checkbox')
            ) as (HTMLElement & { checked: boolean; indeterminate: boolean })[];
            
            const allChecked = childCheckboxes.every(cb => cb.checked);
            const allUnchecked = childCheckboxes.every(cb => !cb.checked && !cb.indeterminate);
            
            checkbox.checked = allChecked;
            checkbox.indeterminate = !allChecked && !allUnchecked;
        });
    });
}

function getSelectedFiles(): { path: string; repo: string }[] {
    const selected: { path: string; repo: string }[] = [];
    const sections: ('tracking' | 'unversioned')[] = ['tracking', 'unversioned'];
    
    sections.forEach(section => {
        const tree = document.getElementById(`${section}-tree`);
        if (!tree) return;
        
        const fileItems = tree.querySelectorAll('.tree-item');
        fileItems.forEach(item => {
            const [repo, path, _] = (item.id || '').split(':');
            const checkbox = item.querySelector('vscode-checkbox') as HTMLElement & { checked: boolean };
            
            if (checkbox?.checked && repo && path) {
                selected.push({ path, repo });
            }
        });
    });
    
    return selected;
}

// Handle messages from extension
window.addEventListener('message', event => {
    const message = event.data;
    
    switch (message.type) {
        case 'updateStatus':
            currentStatus = message.status;
            updateView();
            break;
        case 'getSelection':
            vscode.postMessage({
                type: 'selection',
                selection: getSelectedFiles()
            });
            break;
    }
});

function updateView() {
    if (!currentStatus || !currentStatus.repositories) return;
    
    const sections: ('tracking' | 'unversioned')[] = ['tracking', 'unversioned'];
    
    sections.forEach(section => {
        const treeElement = document.getElementById(`${section}-tree`);
        if (!treeElement) return;
        
        // Clear existing content
        treeElement.innerHTML = '';
        
        if (currentStatus && currentStatus.repositories) {
        // Build and render trees for each repository
        Object.entries(currentStatus.repositories).forEach(([repo, status]) => {
            const files = status[section === 'tracking' ? 'versioned' : 'unversioned'];
            if (!files || files.length === 0) return;
            
            const tree = buildFileTree(files, repo, section);
            renderTree(tree, treeElement);
        });
    }
    });
}

// Initialize view when DOM is loaded
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', updateView);
} else {
    updateView();
}
