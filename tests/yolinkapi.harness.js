/* eslint-disable max-classes-per-file */
/* eslint-disable no-console */

'use strict';

const Module = require('module');

const originalModuleLoad = Module._load;
Module._load = function patchedModuleLoad(request, parent, isMain)
{
	if (request === 'homey')
	{
		return {
			Device: class DeviceStub
			{ },
			SimpleClass: class SimpleClassStub
			{ },
		};
	}

	return originalModuleLoad.call(this, request, parent, isMain);
};

const YoLinkAPI = require('../yoLinkAPI');
const mqtt = require('../mqtt');
const GarageDoorDevice = require('../drivers/garage_door/device');

const TEST_UAID_A = 'ua_11111111111111111111111111111111';
const TEST_UAID_B = 'ua_22222222222222222222222222222222';

Module._load = originalModuleLoad;

function createMockApp(initialUAIDList)
{
	const settingsStore = {
		UAIDList: Array.isArray(initialUAIDList) ? initialUAIDList : [],
	};

	return {
		homeyID: 'harness-homey',
		updateLog: () =>
		{ },
		varToString: (value) =>
		{
			try
			{
				return JSON.stringify(value);
			}
			catch (error)
			{
				return String(value);
			}
		},
		homey: {
			settings: {
				get: (key) => settingsStore[key],
				set: (key, value) =>
				{
					settingsStore[key] = value;
				},
			},
			drivers: {
				getDrivers: () => ({}),
			},
		},
	};
}

function sleep(ms)
{
	return new Promise((resolve) => setTimeout(resolve, ms));
}

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

async function testServiceZoneNormalization()
{
	const api = new YoLinkAPI(createMockApp([]));
	assert(api.getServiceZoneID('EU') === 'eu', 'Expected uppercase zone to normalize to eu');
	assert(api.getServiceZoneID('us-west') === 'us', 'Expected us-west to map to us');
	assert(api.getServiceZoneID(null) === 'us', 'Expected null zone to fallback to us');
}

async function testTokenURLByZone()
{
	const api = new YoLinkAPI(createMockApp([]));
	assert(api.getTokenURL('eu').indexOf('api-eu.yosmart.com') >= 0, 'Expected EU token URL for eu zone');
	assert(api.getTokenURL('us').indexOf('api.yosmart.com') >= 0, 'Expected US token URL for us zone');
}

async function testSameUaidRefreshIsDeduped()
{
	const now = Date.now();
	const api = new YoLinkAPI(createMockApp([
		{
			UAID: TEST_UAID_A,
			access_token: 'expired',
			refresh_token: 'refresh_a',
			expires_at: now - 1000,
		},
	]));

	let refreshCalls = 0;
	api.obtainAccessTokenWithRefreshToken = async () =>
	{
		refreshCalls += 1;
		await sleep(50);
		return {
			access_token: 'new_token_a',
			refresh_token: 'new_refresh_a',
			expires_in: 3600,
		};
	};

	const results = await Promise.all([
		api.getAccessTokenForUAID(TEST_UAID_A, null, 'us'),
		api.getAccessTokenForUAID(TEST_UAID_A, null, 'us'),
	]);

	assert(refreshCalls === 1, `Expected one refresh call, got ${refreshCalls}`);
	assert(results[0] === 'new_token_a' && results[1] === 'new_token_a', 'Expected both calls to return refreshed token');
}

async function testDifferentUaidRefreshCanRunConcurrently()
{
	const now = Date.now();
	const api = new YoLinkAPI(createMockApp([
		{
			UAID: TEST_UAID_A,
			access_token: 'expired_a',
			refresh_token: 'refresh_a',
			expires_at: now - 1000,
		},
		{
			UAID: TEST_UAID_B,
			access_token: 'expired_b',
			refresh_token: 'refresh_b',
			expires_at: now - 1000,
		},
	]));

	const calls = {};
	api.obtainAccessTokenWithRefreshToken = async (UAID) =>
	{
		calls[UAID] = (calls[UAID] || 0) + 1;
		await sleep(60);
		return {
			access_token: `token_${UAID}`,
			refresh_token: `refresh_${UAID}`,
			expires_in: 3600,
		};
	};

	const startedAt = Date.now();
	await Promise.all([
		api.getAccessTokenForUAID(TEST_UAID_A, null, 'us'),
		api.getAccessTokenForUAID(TEST_UAID_B, null, 'eu'),
	]);
	const elapsed = Date.now() - startedAt;

	assert(calls[TEST_UAID_A] === 1 && calls[TEST_UAID_B] === 1, 'Expected one refresh per UAID');
	assert(elapsed < 110, `Expected concurrent refresh duration under 110ms, got ${elapsed}ms`);
}

async function testGetHomeInfoUsesZoneEndpoint()
{
	const api = new YoLinkAPI(createMockApp([]));
	let tokenZone = null;
	let requestURL = null;

	api.getAccessTokenForUAID = async (UAID, secret, serviceZone) =>
	{
		tokenZone = serviceZone;
		return 'token';
	};

	api.request = async (method, url) =>
	{
		requestURL = url;
		return { desc: 'Success' };
	};

	await api.getHomeInfo('UAID_A', 'eu');
	assert(tokenZone === 'eu', 'Expected getHomeInfo to request token in eu zone');
	assert(requestURL.indexOf('api-eu.yosmart.com') >= 0, 'Expected getHomeInfo to call EU API endpoint');
}

async function testPostMqttMessagePrefersZoneSpecificClient()
{
	const api = new YoLinkAPI(createMockApp([]));
	let publishedBy = null;

	api.MQTTList = [
		{
			UAID: 'UAID_A',
			serviceZoneID: 'us',
			homeID: 'HOME_US',
			mqttReady: Promise.resolve(),
			MQTTClient: {
				publish: (topic, payload, options, callback) =>
				{
					publishedBy = `us:${topic}:${payload}`;
					if (callback) callback(null);
				},
			},
		},
		{
			UAID: 'UAID_A',
			serviceZoneID: 'eu',
			homeID: 'HOME_EU',
			mqttReady: Promise.resolve(),
			MQTTClient: {
				publish: (topic, payload, options, callback) =>
				{
					publishedBy = `eu:${topic}:${payload}`;
					if (callback) callback(null);
				},
			},
		},
	];

	await api.postMQTTMessage({
		UAID: 'UAID_A',
		serviceZoneID: 'eu',
		command: { method: 'test.command' },
	});

	assert(publishedBy && publishedBy.indexOf('eu:yl-home/HOME_EU/**/request') === 0, `Expected EU MQTT client publish, got ${publishedBy}`);
}

async function testTokenRefreshRestartsMqttClient()
{
	const now = Date.now();
	const api = new YoLinkAPI(createMockApp([
		{
			UAID: TEST_UAID_A,
			access_token: 'expired_token',
			refresh_token: 'refresh_a',
			expires_at: now - 1000,
		},
	]));

	let oldClientEnded = false;
	let setupArgs = null;
	const replacementClient = {
		publish: () =>
		{ },
	};

	api.MQTTList = [
		{
			UAID: TEST_UAID_A,
			serviceZoneID: 'us',
			homeID: 'HOME_US',
			mqttReady: Promise.resolve(),
			MQTTClient: {
				end: (force) =>
				{
					oldClientEnded = force === true;
				},
			},
		},
	];

	api.obtainAccessTokenWithRefreshToken = async () => ({
		access_token: 'new_token_a',
		refresh_token: 'new_refresh_a',
		expires_in: 3600,
	});

	api.setupMQTTClient = async (brokerConfig) =>
	{
		setupArgs = brokerConfig;
		return {
			UAID: brokerConfig.UAID,
			homeID: 'HOME_US_NEW',
			serviceZoneID: brokerConfig.serviceZoneID,
			mqttReady: Promise.resolve(),
			MQTTClient: replacementClient,
		};
	};

	const token = await api.getAccessTokenForUAID(TEST_UAID_A, null, 'us');
	await sleep(10);

	assert(token === 'new_token_a', `Expected refreshed token, got ${token}`);
	assert(oldClientEnded, 'Expected the stale MQTT client to be ended');
	assert(setupArgs && setupArgs.username === 'new_token_a', 'Expected MQTT reconnect to use refreshed token');
	assert(api.MQTTList.some((item) => item.MQTTClient === replacementClient), 'Expected MQTT list to contain the refreshed client');
}

async function testMqttAuthFailureInvalidatesTokenAndSchedulesRefresh()
{
	const now = Date.now();
	const api = new YoLinkAPI(createMockApp([
		{
			UAID: 'ua_1234567890ABCDEF1234567890ABCDEF',
			access_token: 'still_cached_token',
			refresh_token: 'refresh_a',
			expires_at: now + 3600000,
			serviceZoneID: 'us',
		},
	]));

	const recordedRetries = [];
	api.scheduleMQTTRetry = (brokerConfig, retryCount, maxRetries, delayOverrideMs) =>
	{
		recordedRetries.push({ brokerConfig, retryCount, maxRetries, delayOverrideMs });
	};

	let connectHandler = null;
	let errorHandler = null;
	let closeHandler = null;
	let messageHandler = null;
	let endedForcefully = false;

	const mqttStub = {
		connect: () => ({
			on: (event, handler) =>
			{
				if (event === 'connect') connectHandler = handler;
				if (event === 'error') errorHandler = handler;
				if (event === 'close') closeHandler = handler;
				if (event === 'message') messageHandler = handler;
			},
			subscribe: (topic, options, callback) =>
			{
				if (callback) callback(null);
			},
			end: (force) =>
			{
				endedForcefully = force === true;
				if (closeHandler)
				{
					closeHandler();
				}
			},
		}),
	};

	const originalConnect = mqtt.connect;
	mqtt.connect = mqttStub.connect;

	api.getHomeInfo = async () => ({ desc: 'Success', data: { id: 'HOME_US' } });

	try
	{
		const setupPromise = api.setupMQTTClient({
			UAID: 'ua_1234567890ABCDEF1234567890ABCDEF',
			url: 'mqtt://api.yosmart.com',
			port: 8003,
			username: 'still_cached_token',
			password: '',
			serviceZoneID: 'us',
		});

		await Promise.resolve();

		assert(typeof connectHandler === 'function', 'Expected MQTT connect handler to be registered');
		assert(typeof errorHandler === 'function', 'Expected MQTT error handler to be registered');
		assert(typeof messageHandler === 'function', 'Expected MQTT message handler to be registered');

		errorHandler(new Error('Connection refused: Not authorized'));
		const result = await setupPromise;
		const entry = api.UAIDList.find((item) => item.UAID === 'ua_1234567890ABCDEF1234567890ABCDEF');

		assert(result === null, 'Expected failed MQTT setup to resolve null');
		assert(endedForcefully, 'Expected MQTT client to be forcefully closed on auth error');
		assert(entry && entry.expires_at === 0, `Expected cached token to be invalidated, got ${entry ? entry.expires_at : 'missing entry'}`);
		assert(recordedRetries.length === 1, `Expected one immediate MQTT retry, got ${recordedRetries.length}`);
		assert(recordedRetries[0].delayOverrideMs === 1000, `Expected immediate retry delay override, got ${recordedRetries[0].delayOverrideMs}`);
	}
	finally
	{
		mqtt.connect = originalConnect;
	}
}

async function testGarageDoorControlUsesAccountUaid()
{
	const device = Object.create(GarageDoorDevice.prototype);
	let capturedArgs = null;

	device.getData = async () => ({
		UAID: 'UAID_ACCOUNT',
		parentDeviceId: 'PARENT_DEVICE_ID',
		parentDeviceUDID: 'PARENT_DEVICE_UDID',
		parentDeviceToken: 'PARENT_DEVICE_TOKEN',
	});
	device.getSettings = async () => ({ serviceZone: 'us' });
	device.homey = {
		app: {
			yoLinkAPI: {
				controlDevice: async (UAID, deviceId, deviceToken, serviceZone, command, params) =>
				{
					capturedArgs = {
						UAID,
						deviceId,
						deviceToken,
						serviceZone,
						command,
						params,
					};
					return { desc: 'Success' };
				},
			},
			updateLog: () =>
			{ },
		},
	};

	const result = await device.onOffCapabilityListener(true);

	assert(result === true, 'Expected garage door control to succeed');
	assert(capturedArgs && capturedArgs.UAID === 'UAID_ACCOUNT', `Expected controlDevice to use the account UAID, got ${capturedArgs ? capturedArgs.UAID : 'no call'}`);
	assert(capturedArgs.deviceId === 'PARENT_DEVICE_ID', 'Expected garage door control to target the parent device ID');
	assert(capturedArgs.deviceToken === 'PARENT_DEVICE_TOKEN', 'Expected garage door control to use the parent device token');
	assert(capturedArgs.command === 'GarageDoor.toggle', 'Expected garage door toggle command');
}

async function main()
{
	const results = [];
	results.push(await runTest('service zone normalization', testServiceZoneNormalization));
	results.push(await runTest('token URL by zone', testTokenURLByZone));
	results.push(await runTest('same UAID refresh is deduped', testSameUaidRefreshIsDeduped));
	results.push(await runTest('different UAID refresh can run concurrently', testDifferentUaidRefreshCanRunConcurrently));
	results.push(await runTest('getHomeInfo uses zone endpoint', testGetHomeInfoUsesZoneEndpoint));
	results.push(await runTest('postMQTTMessage prefers zone-specific client', testPostMqttMessagePrefersZoneSpecificClient));
	results.push(await runTest('token refresh restarts mqtt client', testTokenRefreshRestartsMqttClient));
	results.push(await runTest('mqtt auth failure invalidates token and schedules refresh', testMqttAuthFailureInvalidatesTokenAndSchedulesRefresh));
	results.push(await runTest('garage door control uses account UAID', testGarageDoorControlUsesAccountUaid));

	const failed = results.filter((result) => !result.ok);
	if (failed.length > 0)
	{
		console.error(`\n${failed.length} harness test(s) failed.`);
		process.exitCode = 1;
		return;
	}

	console.log('\nAll harness tests passed.');
}

main().catch((error) =>
{
	console.error('Harness execution failed.');
	console.error(error);
	process.exitCode = 1;
});
