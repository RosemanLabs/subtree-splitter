import * as fs from 'fs';

function isErrnoException(e: unknown): e is NodeJS.ErrnoException {
    return ('code' in (e as any));
}

function dirExists(path: string): void {
    try {
        fs.mkdirSync(path);
    } catch (err) {
        if (isErrnoException(err) && err.code !== 'EEXIST') {
            throw err;
        }
    }
}

function removeDir(path: string) {
    try {
        fs.rmdirSync(path, { recursive: true });
    } catch (err) {
        if (isErrnoException(err) && err.code !== 'ENOENT') {
            throw err;
        }
    }
}

function removeFile(path: string) {
    try {
        fs.unlinkSync(path);
    } catch (err) {
        if (isErrnoException(err) && err.code !== 'ENOENT') {
            throw err;
        }
    }
}

export { dirExists, removeDir, removeFile };
