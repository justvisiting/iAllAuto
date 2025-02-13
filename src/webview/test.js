// Test utilities
function assert(condition, message) {
    if (!condition) {
        console.error('❌ Test Failed:', message);
        throw new Error(message);
    }
    console.log('✅ Test Passed:', message);
}

// Mock data for testing
const mockStatus = {
    repositories: {
        '/repo1': {
            versioned: ['file1.js', 'file2.js'],
            unversioned: ['.file3', '.file4']
        },
        '/repo2': {
            versioned: ['file5.js'],
            unversioned: ['.file6']
        }
    }
};

// Test functions
function testCheckboxStates() {
    console.log('🧪 Testing checkbox states...');
    
    // Setup
    currentStatus = mockStatus;
    selectedFiles = new Map();
    updateView();

    // Test 1: Initial state - all checkboxes should be unchecked
    assert(
        !document.querySelector('#toggle-tracking').nextElementSibling.checked,
        'Section checkbox should be unchecked initially'
    );

    // Test 2: Select one file
    toggleFile('/repo1', 'file1.js');
    assert(
        document.querySelector('#toggle-versioned-/repo1').nextElementSibling.querySelector('input').indeterminate,
        'Repo checkbox should be indeterminate when some files selected'
    );
    assert(
        document.querySelector('#toggle-tracking').nextElementSibling.indeterminate,
        'Section checkbox should be indeterminate when some files selected'
    );

    // Test 3: Select all files in repo
    toggleAllFiles('/repo1', 'versioned');
    assert(
        document.querySelector('#toggle-versioned-/repo1').nextElementSibling.querySelector('input').checked,
        'Repo checkbox should be checked when all files selected'
    );

    // Test 4: Select all files in section
    toggleAllInSection('tracking');
    assert(
        document.querySelector('#toggle-tracking').nextElementSibling.checked,
        'Section checkbox should be checked when all files selected'
    );

    // Test 5: Unselect one file
    toggleFile('/repo1', 'file1.js');
    assert(
        document.querySelector('#toggle-versioned-/repo1').nextElementSibling.querySelector('input').indeterminate,
        'Repo checkbox should be indeterminate when some files unselected'
    );
    assert(
        document.querySelector('#toggle-tracking').nextElementSibling.indeterminate,
        'Section checkbox should be indeterminate when some files unselected'
    );

    console.log('✅ All checkbox state tests passed!');
}

function testSelectionPersistence() {
    console.log('🧪 Testing selection persistence...');
    
    // Setup
    currentStatus = mockStatus;
    selectedFiles = new Map();
    updateView();

    // Test 1: Select files and verify they stay selected
    toggleFile('/repo1', 'file1.js');
    toggleFile('/repo2', 'file5.js');
    updateView();
    
    assert(
        selectedFiles.get('/repo1').has('file1.js'),
        'Selection should persist after updateView'
    );
    assert(
        selectedFiles.get('/repo2').has('file5.js'),
        'Selection should persist across repos'
    );

    console.log('✅ All selection persistence tests passed!');
}

function testToggleOperations() {
    console.log('🧪 Testing toggle operations...');
    
    // Setup
    currentStatus = mockStatus;
    selectedFiles = new Map();
    updateView();

    // Test 1: Toggle section should affect all repos
    toggleAllInSection('tracking');
    assert(
        Array.from(selectedFiles.get('/repo1')).length === 2 &&
        Array.from(selectedFiles.get('/repo2')).length === 1,
        'Section toggle should affect all repos'
    );

    // Test 2: Toggle repo should not affect other repos
    toggleAllFiles('/repo1', 'versioned');
    assert(
        Array.from(selectedFiles.get('/repo1')).length === 0 &&
        Array.from(selectedFiles.get('/repo2')).length === 1,
        'Repo toggle should only affect its own files'
    );

    console.log('✅ All toggle operation tests passed!');
}

// Run all tests
function runAllTests() {
    console.log('🧪 Running all tests...');
    try {
        testCheckboxStates();
        testSelectionPersistence();
        testToggleOperations();
        console.log('✅ All tests passed successfully!');
    } catch (error) {
        console.error('❌ Tests failed:', error);
    }
}

// Add test button to UI
function addTestButton() {
    const button = document.createElement('button');
    button.textContent = 'Run Tests';
    button.onclick = runAllTests;
    button.style.position = 'fixed';
    button.style.bottom = '10px';
    button.style.right = '10px';
    document.body.appendChild(button);
}
