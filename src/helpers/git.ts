import { exec } from '@actions/exec';
import * as core from '@actions/core';
import { getExecOutput } from './github';

async function ensureRemoteExists(name: string, target: string): Promise<void> {
    try {
        await exec('git', ['remote', 'add', name, target]);
    } catch (e: any) {
        if ( ! e.message.match(/failed with exit code 3$/g)) {
            throw e;
        }
    }
}

async function tagExists(tag: string, directory: string): Promise<boolean> {
    try {
        let code = await exec('git', ['show-ref', '--tags', '--quiet', '--verify', '--', `refs/tags/${tag}`], { cwd: directory });

        return code === 0;
    } catch (err) {
        return false;
    }
}

async function publishSubSplit(binary: string, target: string, branch: string, name: string, directory: string): Promise<void> {
    const hash = (await getExecOutput(binary, [`--prefix=${directory}`, `--origin=origin/${branch}`])).trim();
    const isAncestor = await exec('git', ['merge-base', '--is-ancestor', hash, 'HEAD'], {ignoreReturnCode: true});
    if (isAncestor !== 0) {
        const tree_hash = (await getExecOutput('git', ['write-tree'])).trim();
        const message = `Split '${directory}' into commit '${hash}'`;
        // Note: if we do more than one split, we can merge all of these join commits into a single one
        const merged_hash = await getExecOutput('git', ['commit-tree', '-p', 'HEAD', '-p', hash.trim(), '-m', message, tree_hash]);
        await exec('git', ['reset', '--hard', merged_hash]);
        await exec('git', ['push']);
    }
    await exec('git', ['push', target, `${hash}:refs/heads/${branch}`, '-f']);
}

async function commitHashHasTag(hash: string, clonePath: string) {
    let output = await getExecOutput('git', ['tag', '--points-at', hash], { cwd: clonePath });

    core.info(`${hash} points-at ${output}`);

    return output !== '';
}

export { ensureRemoteExists, tagExists, publishSubSplit, commitHashHasTag }
