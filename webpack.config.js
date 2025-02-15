const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');

module.exports = (env = {}) => {
    const config = {
        target: 'web',
        entry: {
            script: './src/webview/script.ts'
        },
        output: {
            path: path.resolve(__dirname, 'out'),
            filename: '[name].js'
        },
        devServer: {
            static: {
                directory: path.join(__dirname, 'src/webview'),
            },
            port: 3000,
            hot: true
        },
        module: {
            rules: [
                {
                    test: /\.tsx?$/,
                    use: [
                        {
                            loader: 'ts-loader',
                            options: {
                                configFile: path.resolve(__dirname, 'src/webview/tsconfig.json')
                            }
                        }
                    ],
                    exclude: /node_modules/
                },
                {
                    test: /\.css$/,
                    use: ['style-loader', 'css-loader']
                }
            ]
        },
        resolve: {
            extensions: ['.tsx', '.ts', '.js']
        },
        plugins: []
    };

    // Development specific configuration
    if (env.development) {
        config.mode = 'development';
        config.devtool = 'inline-source-map';
        
        if (env.page === 'dev') {
            config.plugins.push(
                new HtmlWebpackPlugin({
                    template: './src/webview/dev.html',
                    filename: 'dev.html'
                })
            );
        } else if (env.page === 'tree') {
            config.entry = {
                tree: './src/webview/tree.ts'
            };
            config.plugins.push(
                new HtmlWebpackPlugin({
                    template: './src/webview/tree.html',
                    filename: 'tree.html'
                }),
                new CopyWebpackPlugin({
                    patterns: [
                        { from: 'src/webview/assets', to: 'assets' }
                    ]
                })
            );
        }
    } else {
        // Production configuration
        config.mode = 'production';
        config.plugins.push(
            new CopyWebpackPlugin({
                patterns: [
                    { from: 'src/webview/assets', to: 'assets' }
                ]
            })
        );
    }

    return config;
};
