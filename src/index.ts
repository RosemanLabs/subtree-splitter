import * as core from '@actions/core';
import * as github from '@actions/github';
import { exec } from '@actions/exec';
import { CreateEvent, DeleteEvent } from '@octokit/webhooks-types';
import { configurationOptions, subtreeSplit } from './types';
import { removeDir, dirExists, removeFile } from './helpers/fs';
import { ensureRemoteExists, tagExists, publishSubSplit } from './helpers/git';
import { getExecOutput } from './helpers/github';
import * as fs from 'fs';
import * as path from 'path';

const splitshPath = './splitsh'

async function downloadSplitsh(): Promise<void> {
    let splitshDir = path.dirname(splitshPath);
    let downloadDir = '/tmp/splitsh/';

    dirExists(splitshDir);
    removeFile(splitshPath);
    removeDir(downloadDir);

    fs.mkdirSync(downloadDir);

    let downloadPath = `${downloadDir}split-lite.tar.gz`;


    if (process.platform === 'darwin') {
        throw new Error("We do not support darwin runners");
    }
    let platform = 'lite_linux_amd64';
    // let platform = process.platform === 'darwin' ? 'lite_darwin_amd64' : 'lite_linux_amd64';

    core.debug(`Downloading splitsh for "${platform}"`);

    let url = `https://github.com/splitsh/lite/releases/download/v1.0.1/${platform}.tar.gz`;

    await exec(`wget -O ${downloadPath} ${url}`);
    const output = await getExecOutput("sha256sum", [downloadPath]);
    const hash = output.split(" ")[0];
    if (hash !== "2539301ce5e21d0ca44b689d0dd2c1b20d9f9e996c1fe6c462afb8af4e7141cc") {
        throw new Error("Hash verification of downloaded splitsh failed");
    }

    await exec(`tar -zxpf ${downloadPath} --directory ${downloadDir}`);
    await exec(`chmod +x ${downloadDir}splitsh-lite`);
    await exec(`mv ${downloadDir}splitsh-lite ${splitshPath}`);

    removeDir(downloadDir);
}

/**
 * @param {function(subtreeSplit): Promise<void>} handler
 */
async function promiseAllInBatches(subtreeSplits: subtreeSplit[], batchSize: number, handler: any): Promise<void> {
    let position = 0;
    while (position < subtreeSplits.length) {
        core.info('Processing batch ' + (position / batchSize + 1) + '/'+(Math.round(subtreeSplits.length / batchSize)));

        const itemsForBatch = subtreeSplits.slice(position, position + batchSize);

        await Promise.all(itemsForBatch.map(split => handler(split)));
        position += batchSize;
    }
}

(async () => {
    const context = github.context;
    const configPath = core.getInput('config-path');
    const batchSizeConfig = core.getInput('batch-size');
    const batchSize = isNaN(parseInt(batchSizeConfig)) ? 1 : parseInt(batchSizeConfig);

    if (!fs.existsSync(splitshPath)) {
        await downloadSplitsh();
    }

    let configOptions = JSON.parse(fs.readFileSync(configPath).toString()) as configurationOptions;
    let subtreeSplits = configOptions['subtree-splits'];

    console.table(subtreeSplits);

    // Make sure all remotes are correctly setup, this must be done synchronously to avoid race conditions.
    for (let split of subtreeSplits) {
        await ensureRemoteExists(split.name, split.target);
    }

    if (context.eventName === 'push' ) {
        if (!context.ref.includes('refs/heads')) {
            core.info('Push event was for a tag, skipping...');

            return;
        }

        const branch = context.ref.split('/').pop();
        if (typeof branch == 'undefined') {
            core.error('Unable to get branch name from event data. Got ref "'+context.ref+'"');

            return;
        }

        // On push sync commits
        await promiseAllInBatches(subtreeSplits, batchSize, async (split: subtreeSplit) => {
            await publishSubSplit(splitshPath, split.name, branch, split.name, split.directory);
        });
    } else if (context.eventName === 'create') {
        // Tag created
        let event = context.payload as CreateEvent;
        let tag = event.ref;

        if (event.ref_type !== 'tag') {
            core.info('No tag was created, skipping...');

            return;
        }

        await promiseAllInBatches(subtreeSplits, batchSize, async (split: subtreeSplit) => {
            let hash = await getExecOutput(splitshPath, [`--prefix=${split.directory}`, `--origin=tags/${tag}`]);
            let clonePath = `./.repositories/${split.name}/`;

            fs.mkdirSync(clonePath, { recursive: true});

            await exec('git', ['clone', split.target, '.'], { cwd: clonePath});

            // TODO: smart tag skipping (skip patch releases where commit was previously tagged) minor and major releases should always get a tag

            if (!await tagExists(tag, clonePath)) {
                await exec('git', ['tag', '-a', tag, hash, '-m', `"Tag ${tag}"`], {cwd: clonePath});
            }
            await exec('git', ['push', '--tags'], { cwd: clonePath });
        });
    } else if (context.eventName === 'delete') {
        // Tag removed
        let event = context.payload as DeleteEvent;
        let tag = event.ref;

        if (event.ref_type !== 'tag') {
            core.info('No tag was deleted, skipping...');

            return;
        }

        await promiseAllInBatches(subtreeSplits, batchSize, async (split: subtreeSplit) => {
            let clonePath = `./.repositories/${split.name}/`;
            fs.mkdirSync(clonePath, { recursive: true});

            await exec('git', ['clone', split.target, '.'], { cwd: clonePath});

            if (await tagExists(tag, clonePath)) {
                await exec('git', ['push', '--delete', 'origin', tag], { cwd: clonePath});
            }
        });
    }
})().catch(error => {
    core.setFailed(error);
});
