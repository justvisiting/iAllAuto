const path = require('path');
const webpack = require('webpack');

module.exports = (env) => ({
    mode: env.production ? 'production' : 'development',
    devtool: env.production ? false : 'inline-source-map',
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
    },
    plugins: [
        new webpack.DefinePlugin({
            __DEV__: env.production ? 'false' : 'true'
        })
    ]
});
