import * as vscode from 'vscode';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export class GitExecutor {
    private workingDirectory: string;

    constructor(workingDirectory: string) {
        this.workingDirectory = workingDirectory;
    }

    async add(file: string): Promise<void> {
        const relativePath = path.relative(this.workingDirectory, file);
        const { stdout, stderr } = await execAsync(`git add "${relativePath}"`, {
            cwd: this.workingDirectory
        });

        if (stderr) {
            throw new Error(`Git add failed: ${stderr}`);
        }
    }

    async reset(file: string): Promise<void> {
        const relativePath = path.relative(this.workingDirectory, file);
        const { stdout, stderr } = await execAsync(`git reset HEAD "${relativePath}"`, {
            cwd: this.workingDirectory
        });

        if (stderr) {
            throw new Error(`Git reset failed: ${stderr}`);
        }
    }
}
