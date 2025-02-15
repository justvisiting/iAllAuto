const path = require('path');

module.exports = {
    mode: 'development',
    devtool: 'inline-source-map',
    entry: './src/webview/script.ts',
    output: {
        path: path.resolve(__dirname, 'out', 'webview'),
        filename: 'script.js',
        devtoolModuleFilenameTemplate: '../../[resource-path]'
    },
    module: {
        rules: [
            {
                test: /\.ts$/,
                use: 'ts-loader',
                exclude: /node_modules/
            }
        ]
    },
    resolve: {
        extensions: ['.ts', '.js']
    },
    externals: {
        vscode: 'commonjs vscode'
    }
};
