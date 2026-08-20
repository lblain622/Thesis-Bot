module.exports = [
    {ignores: ['node_modules/**', 'Microsoft/**']},
    {
        files: ['**/*.js'],
        languageOptions: {
            ecmaVersion: 2021,
            sourceType: 'commonjs',
            globals: {
                console: 'readonly', module: 'readonly', require: 'readonly', process: 'readonly',
                __dirname: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly',
                setInterval: 'readonly', clearInterval: 'readonly'
            }
        },
        rules: {
            'constructor-super': 'error', 'no-constant-condition': 'error', 'no-dupe-args': 'error',
            'no-dupe-class-members': 'error', 'no-dupe-keys': 'error', 'no-func-assign': 'error',
            'no-import-assign': 'error', 'no-new-native-nonconstructor': 'error', 'no-obj-calls': 'error',
            'no-self-assign': 'error', 'no-setter-return': 'error', 'no-unreachable': 'error',
            'no-unreachable-loop': 'error', 'no-unsafe-finally': 'error', 'no-unsafe-negation': 'error',
            'no-with': 'error', 'use-isnan': 'error', 'valid-typeof': 'error'
        }
    }
];
