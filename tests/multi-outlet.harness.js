/* eslint-disable no-console */
/* eslint-disable max-classes-per-file */

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
			Driver: class DriverStub
			{ },
		};
	}

	return originalModuleLoad.call(this, request, parent, isMain);
};

const MultiOutletDriver = require('../drivers/multi-outlet/driver');
const MultiOutletDevice = require('../drivers/multi-outlet/device');

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

async function testPairingCreatesTwoUniqueOutletDevices()
{
	const driver = Object.create(MultiOutletDriver.prototype);
	driver.deviceType = 'MultiOutlet';
	const device = {
		deviceId: 'device-123',
		deviceUDID: 'udid-123',
		name: 'Garden Plug',
		type: 'MultiOutlet',
		modelName: 'YS6802-UC',
		token: 'device-token',
	};

	const pairedDevices = driver.getPairingDevicesForDevice(device, 'uaid');
	assert(pairedDevices.length === 2, `Expected two paired outlets, got ${pairedDevices.length}`);
	assert(pairedDevices[0].name === 'Garden Plug - Outlet 1', 'Expected first outlet name');
	assert(pairedDevices[1].name === 'Garden Plug - Outlet 2', 'Expected second outlet name');
	assert(pairedDevices[0].data.id !== pairedDevices[1].data.id, 'Expected unique Homey device IDs');
	assert(pairedDevices[0].data.deviceId === 'device-123', 'Expected original YoLink device ID to be retained');
	assert(pairedDevices[0].data.outletIndex === 0 && pairedDevices[1].data.outletIndex === 1, 'Expected zero-based outlet indexes');
}

async function testOnlyYS6802ModelIsMatched()
{
	const driver = Object.create(MultiOutletDriver.prototype);
	driver.deviceType = 'MultiOutlet';
	assert(driver.isSupportedDevice({ type: 'MultiOutlet', modelName: 'YS6802-UC' }), 'Expected YS6802-UC to be supported');
	assert(!driver.isSupportedDevice({ type: 'MultiOutlet', modelName: 'YS6801-UC' }), 'Expected other MultiOutlet models not to be claimed');
	assert(!driver.isSupportedDevice({ type: 'Outlet', modelName: 'YS6802-UC' }), 'Expected non-MultiOutlet type not to be claimed');
}

async function testOutletControlUsesChannelBitmask()
{
	for (let outletIndex = 0; outletIndex < 2; outletIndex++)
	{
		let captured;
		const device = {
			getData: async () => ({
				UAID: 'uaid',
				deviceId: 'device-123',
				deviceToken: 'device-token',
				outletIndex,
			}),
			getSettings: async () => ({ serviceZone: 'us' }),
			homey: {
				app: {
					updateLog: () =>
					{ },
					yoLinkAPI: {
						controlDevice: async (...args) =>
						{
							captured = args;
							return { desc: 'Success' };
						},
					},
				},
			},
		};

		await MultiOutletDevice.prototype.onOffCapabilityListener.call(device, true);
		assert(captured[1] === 'device-123', 'Expected original YoLink device ID in control command');
		assert(captured[4] === 'MultiOutlet.setState', 'Expected MultiOutlet.setState command');
		assert(captured[5].chs === (1 << outletIndex), `Expected channel mask ${1 << outletIndex}`);
		assert(captured[5].state === 'open', 'Expected the requested outlet state');
	}
}

async function testStateRequestsUseOriginalYoLinkDeviceId()
{
	const driver = Object.create(MultiOutletDriver.prototype);
	let statusDeviceId;
	let mqttMessage;
	driver.homey = {
		app: {
			yoLinkAPI: {
				getDeviceStatus: async (uaid, type, deviceId) =>
				{
					statusDeviceId = deviceId;
					return { data: { state: ['open', 'close'] } };
				},
				postMQTTMessage: (message) =>
				{
					mqttMessage = message;
				},
			},
		},
	};
	const data = {
		id: 'device-123-outlet-2',
		deviceId: 'device-123',
		deviceToken: 'device-token',
		outletIndex: 1,
		type: 'MultiOutlet',
		UAID: 'uaid',
	};

	await driver.getState(data, { serviceZone: 'us' });
	driver.updateMQTTState(data);
	assert(statusDeviceId === 'device-123', 'Expected status request to use original YoLink device ID');
	assert(mqttMessage.command.targetDevice === 'device-123', 'Expected MQTT state request to use original YoLink device ID');
}

async function testMqttStateUpdatesMatchingOutlet()
{
	for (let outletIndex = 0; outletIndex < 2; outletIndex++)
	{
		let state;
		const device = {
			getData: async () => ({ deviceId: 'device-123', outletIndex }),
			setAvailable: () => Promise.resolve(),
			setCapabilityValue: (capability, value) =>
			{
				assert(capability === 'onoff', 'Expected onoff capability update');
				state = value;
				return Promise.resolve();
			},
			error: () =>
			{ },
		};
		const handled = await MultiOutletDevice.prototype.processMQTTMessage.call(device, {
			deviceId: 'device-123',
			data: { state: ['open', 'close'] },
		});

		assert(handled, 'Expected message to be handled');
		assert(state === (outletIndex === 0), `Expected outlet ${outletIndex + 1} to receive its own state`);
	}
}

async function main()
{
	const results = [];
	results.push(await runTest('pairing creates two unique outlet devices', testPairingCreatesTwoUniqueOutletDevices));
	results.push(await runTest('only YS6802-UC is matched', testOnlyYS6802ModelIsMatched));
	results.push(await runTest('outlet control uses channel bitmask', testOutletControlUsesChannelBitmask));
	results.push(await runTest('state requests use original YoLink device ID', testStateRequestsUseOriginalYoLinkDeviceId));
	results.push(await runTest('MQTT state updates the matching outlet', testMqttStateUpdatesMatchingOutlet));

	const failed = results.filter((result) => !result.ok);
	if (failed.length > 0)
	{
		console.error(`\n${failed.length} multi-outlet harness test(s) failed.`);
		process.exitCode = 1;
		return;
	}

	console.log('\nAll multi-outlet harness tests passed.');
}

main().catch((error) =>
{
	console.error('Multi-outlet harness execution failed.');
	console.error(error);
	process.exitCode = 1;
});
