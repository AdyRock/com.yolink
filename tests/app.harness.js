/* eslint-disable no-console */

'use strict';

const Module = require('module');

const originalModuleLoad = Module._load;
Module._load = function patchedModuleLoad(request, parent, isMain)
{
	if (request === 'homey')
	{
		return {
			App: class AppStub {},
			SimpleClass: class SimpleClassStub {},
			env: {},
			manifest: { version: '0.0.0-test' },
		};
	}

	return originalModuleLoad.call(this, request, parent, isMain);
};

const YoLinkApp = require('../app');

Module._load = originalModuleLoad;

function assert(condition, message)
{
	if (!condition)
	{
		throw new Error(message);
	}
}

async function runTest(name, fn)
{
	try
	{
		await fn();
		console.log('PASS:', name);
		return { name, ok: true };
	}
	catch (error)
	{
		console.error('FAIL:', name);
		console.error(error.message);
		return { name, ok: false, error };
	}
}

function createAppInstance()
{
	const app = new YoLinkApp();
	const settings = {
		logEnabled: true,
	};

	app.log = () => {};
	app.error = () => {};
	app.cloudOnly = true;
	app.homey = {
		settings: {
			get: (key) => settings[key],
			set: (key, value) =>
			{
				settings[key] = value;
			},
		},
		api: {
			realtime: () => {},
		},
		__: (key) => key,
	};

	return app;
}

async function testUpdateLogInitializesDiagLog()
{
	const app = createAppInstance();
	app.diagLog = undefined;
	app.updateLog('harness log line');
	assert(typeof app.diagLog === 'string', 'Expected diagLog to be initialized as a string');
	assert(app.diagLog.includes('harness log line'), 'Expected diagLog to include the appended log line');
}

async function testGetDeviceListHandlesNullResponsesAndDedupes()
{
	const app = createAppInstance();
	app.varToString = (value) => value;
	app.yoLinkAPI = {
		getUAIDList: async () => ['UAID_A'],
		getDeviceList: async (uaid, secret, zone) =>
		{
			if (zone === 'us')
			{
				return null;
			}
			return [
				{ UID: 'D1', name: 'EU Device 1' },
				{ UID: 'D1', name: 'EU Device 1 Duplicate' },
				{ UID: 'D2', name: 'EU Device 2' },
			];
		},
	};

	const devices = await app.getDeviceList();
	assert(Array.isArray(devices), 'Expected getDeviceList result to be an array');
	assert(devices.length === 2, `Expected deduped length of 2, got ${devices.length}`);
	assert(devices.find((item) => item.UID === 'D1'), 'Expected UID D1 in result');
	assert(devices.find((item) => item.UID === 'D2'), 'Expected UID D2 in result');
}

async function testVarToStringErrorWithoutStackIsSafe()
{
	const app = createAppInstance();
	const error = new Error('test error');
	error.stack = undefined;
	const text = app.varToString(error);
	assert(typeof text === 'string', 'Expected varToString to return a string');
	assert(text.includes('test error'), 'Expected varToString output to include error message');
}

async function main()
{
	const results = [];
	results.push(await runTest('updateLog initializes diagLog', testUpdateLogInitializesDiagLog));
	results.push(await runTest('getDeviceList handles null responses and dedupes', testGetDeviceListHandlesNullResponsesAndDedupes));
	results.push(await runTest('varToString error without stack is safe', testVarToStringErrorWithoutStackIsSafe));

	const failed = results.filter((result) => !result.ok);
	if (failed.length > 0)
	{
		console.error(`\n${failed.length} app harness test(s) failed.`);
		process.exitCode = 1;
		return;
	}

	console.log('\nAll app harness tests passed.');
}

main().catch((error) =>
{
	console.error('App harness execution failed.');
	console.error(error);
	process.exitCode = 1;
});
