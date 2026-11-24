/* eslint-disable no-console, max-classes-per-file */

'use strict';

const Module = require('module');
const fs = require('fs');
const path = require('path');

const originalModuleLoad = Module._load;
Module._load = function patchedModuleLoad(request, parent, isMain)
{
	if (request === 'homey')
	{
		return {
			Driver: class DriverStub
			{},
			Device: class DeviceStub
			{},
		};
	}

	return originalModuleLoad.call(this, request, parent, isMain);
};

const YoLinkDriver = require('../drivers/yoLinkDriver');
const THDevice = require('../drivers/temperature-and-humidity/device');
const WaterMeterDevice = require('../drivers/water-meter-controller/device');
const WaterMeterDriver = require('../drivers/water-meter-controller/driver');
const waterMeterFlows = require('../drivers/water-meter-controller/driver.flow.compose.json');

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

function createTHDevice(capabilities, store = {})
{
	const device = new THDevice();
	const caps = new Map(capabilities.map((capability) => [capability, null]));
	device.hasCapability = (capability) => caps.has(capability);
	device.addCapability = async (capability) => caps.set(capability, null);
	device.removeCapability = async (capability) => caps.delete(capability);
	device.setCapabilityValue = async (capability, value) =>
	{
		if (!caps.has(capability))
		{
			throw new Error(`Missing capability ${capability}`);
		}
		caps.set(capability, value);
	};
	device.getStoreValue = (key) => store[key];
	device.setStoreValue = async (key, value) =>
	{
		store[key] = value;
	};
	device.error = () =>
	{};
	device.homey = { app: { updateLog: () =>
	{} } };
	return { device, caps, store };
}

async function testBatteryPercentageReportsEmptyBattery()
{
	const driver = new YoLinkDriver();
	assert(driver.getBatteryPercentage(0) === 0, 'Expected level 0 to be 0%');
	assert(driver.getBatteryPercentage('0') === 0, 'Expected level "0" to be 0%');
	assert(driver.getBatteryPercentage(1) === 25, 'Expected level 1 to be 25%');
	assert(driver.getBatteryPercentage('4') === 100, 'Expected level "4" to be 100%');
	assert(driver.getBatteryPercentage(7) === 100, 'Expected out of range level to be clamped to 100%');
	assert(driver.getBatteryPercentage(undefined) === null, 'Expected missing level to be null');
	assert(driver.getBatteryPercentage('') === null, 'Expected empty level to be null');
}

async function testHumidityRemovedForTemperatureOnlySensor()
{
	const { device, caps } = createTHDevice(['measure_temperature', 'measure_humidity', 'measure_battery']);
	await device.updateHumidity(0);
	assert(!caps.has('measure_humidity'), 'Expected humidity to be removed when only 0 has been reported');
	await device.updateHumidity(undefined);
	assert(!caps.has('measure_humidity'), 'Expected missing humidity to leave the capabilities unchanged');
}

async function testHumidityKeptForHumiditySensor()
{
	const { device, caps, store } = createTHDevice(['measure_temperature', 'measure_humidity', 'measure_battery']);
	await device.updateHumidity(45);
	assert(caps.get('measure_humidity') === 45, 'Expected humidity value to be set');
	assert(store.humidityReported === true, 'Expected humidityReported to be stored');
	await device.updateHumidity(0);
	assert(caps.get('measure_humidity') === 0, 'Expected 0% to be kept once humidity has been reported');
}

async function testHumidityRestoredWhenReportedLater()
{
	const { device, caps } = createTHDevice(['measure_temperature', 'measure_battery']);
	await device.updateHumidity(30);
	assert(caps.get('measure_humidity') === 30, 'Expected humidity to be added back when a value is reported');
}

function createWaterMeterDevice()
{
	const device = new WaterMeterDevice();
	const caps = new Map([
		['alarm_water', false],
		['alarm_problem', false],
		['onoff', true],
	]);
	const triggers = [];
	const events = [];
	const card = (name) => ({
		trigger: async (target, tokens, state) =>
		{
			events.push({ name, target, tokens, state });
		},
	});
	device.getData = () => ({ id: 'meter' });
	device.getSettings = () => ({});
	device.hasCapability = (capability) => caps.has(capability);
	device.addCapability = async (capability) => caps.set(capability, null);
	device.getCapabilityValue = (capability) =>
	{
		assert(caps.has(capability), `Cannot read missing capability ${capability}`);
		return caps.get(capability);
	};
	device.getCapabilityOptions = () => ({});
	device.setCapabilityOptions = async () => {};
	device.setCapabilityValue = async (capability, value) =>
	{
		if (!caps.has(capability))
		{
			throw new Error(`Missing capability ${capability}`);
		}
		caps.set(capability, value);
	};
	device.markOnline = () => {};
	device.setAvailable = async () => {};
	device.unsetWarning = async () => {};
	device.registerCapabilityListener = () => {};
	device.log = () => {};
	device.error = (error) => { throw error; };
	device.homey = { app: { updateLog: () => {} } };
	device.driver = {
		manifest: require('../drivers/water-meter-controller/driver.compose.json'),
		getBatteryPercentage: YoLinkDriver.prototype.getBatteryPercentage,
		waterMeterAlarm: { trigger: async (target, tokens, state) => triggers.push(state.alarm) },
		waterMeterAlarmCleared: card('alarmCleared'),
		waterMeterFlowStarted: card('flowStarted'),
		waterMeterFlowStopped: card('flowStopped'),
		waterMeterDurationChanged: card('durationChanged'),
		waterMeterPowerChanged: card('powerChanged'),
		waterMeterValveDelayChanged: card('valveDelayChanged'),
		updateMQTTState: () => {},
	};
	return { device, caps, triggers, events };
}

async function testWaterMeterMigrationAndState()
{
	const { device, caps, triggers } = createWaterMeterDevice();
	for (const capability of ['meter_water', 'measure_flushes', 'measure_battery'])
	{
		caps.set(capability, null);
	}
	device.driver.getState = async () => ({
		data: { state: {
			attributes: { meterUnit: 3 },
			state: { valve: 'close', meter: 100, waterFlowing: false },
			alarm: { durationOverrun: true, amountOverrun: false, leak: false },
			dailyUsage: 42,
			recentUsage: { amount: 5, duration: 12 },
			temperature: 18.5,
			battery: 0,
			powerSupply: 'PowerLine',
			valveDelay: { on: 0, off: 4 },
		} },
	});
	let refresh;
	device.refreshState = () =>
	{
		refresh = device.updateState();
		return refresh;
	};
	await device.onInit();
	await refresh;
	assert(caps.get('alarm_generic.duration_overrun') === true, 'Expected duration alarm to be restored');
	assert(triggers.join(',') === 'durationOverrun', 'Expected a duration alarm Flow trigger');
	assert(caps.get('water_flowing') === false && caps.get('onoff') === false, 'Expected valve and flow state');
	assert(caps.get('meter_water.daily') === 42, 'Expected numeric daily usage');
	assert(caps.has('meter_water.recent_usage') && caps.get('meter_water.recent_usage') === 5 && caps.get('measure_water_duration') === 12, 'Expected migrated recent usage and duration');
	assert(caps.get('measure_temperature') === 18.5 && caps.get('measure_battery') === 0, 'Expected temperature and empty battery');
	assert(caps.get('water_meter_power_source') === 'line', 'Expected external power source');
	assert(caps.get('measure_valve_delay.open') === 0 && caps.get('measure_valve_delay.close') === 4, 'Expected valve delays');
}

async function testWaterMeterDynamicCapabilities()
{
	const { device, caps, events } = createWaterMeterDevice();
	const manifest = device.driver.manifest;
	for (const capability of manifest.capabilities)
	{
		caps.set(capability, null);
	}
	const initialCapabilities = [...caps.keys()];
	const additions = [];
	const options = new Map();
	device.addCapability = async (capability) =>
	{
		assert(!caps.has(capability), `Capability added twice: ${capability}`);
		additions.push(capability);
		caps.set(capability, null);
	};
	device.getCapabilityOptions = (capability) =>
	{
		assert(caps.has(capability), `Cannot read options for missing capability ${capability}`);
		return options.get(capability) || {};
	};
	device.setCapabilityOptions = async (capability, value) =>
	{
		assert(caps.has(capability), `Cannot set options for missing capability ${capability}`);
		options.set(capability, value);
	};
	device.refreshState = async () => true;
	await device.onInit();
	assert([...caps.keys()].join(',') === initialCapabilities.join(','), 'Expected no optional capabilities before a report');
	await device.applyState({
		alarm: { reminder: null, freezeError: 'false' },
		temperature: NaN,
		recentUsage: { duration: -1 },
		powerSupply: 'unknown',
		valveDelay: { on: Infinity, off: null },
	});
	assert(additions.length === 0, 'Expected invalid optional values not to create capabilities');
	await device.applyState({ recentUsage: { amount: 0 } });
	assert(!caps.has('meter_water.recent_usage'), 'Expected no usage capability without conversion attributes');
	const reported = {
		attributes: { meterUnit: 3 },
		alarm: { overrunAmount24H: false },
		state: { waterFlowing: false },
		temperature: 0,
		recentUsage: { amount: 0, duration: 0 },
		dailyUsage: { amount: 0 },
		powerSupply: 'battery',
		valveDelay: { on: 0 },
	};
	await device.applyState(reported);
	for (const capability of ['measure_temperature', 'measure_water_duration', 'meter_water.recent_usage', 'meter_water.daily', 'measure_valve_delay.open'])
	{
		assert(caps.get(capability) === 0, `Expected reported zero to add and populate ${capability}`);
	}
	assert(caps.get('alarm_generic.amount_overrun') === false && caps.get('water_flowing') === false, 'Expected reported false to add inactive capabilities');
	assert(caps.get('water_meter_power_source') === 'battery', 'Expected reported power source capability');
	assert(!caps.has('alarm_generic.reminder') && !caps.has('measure_valve_delay.close'), 'Expected omitted capabilities to stay absent');
	assert(options.get('meter_water.recent_usage').units === 'L', 'Expected dynamic usage capability to retain units');
	assert(options.get('alarm_generic.amount_overrun').title.nl === manifest.capabilitiesOptions['alarm_generic.amount_overrun'].title.nl, 'Expected dynamic alarm to retain translated title');
	assert(options.get('measure_valve_delay.open').title.en === 'Open Delay Remaining', 'Expected dynamic delay to retain its specific title');
	const additionCount = additions.length;
	const eventCount = events.length;
	await device.applyState(reported);
	assert(additions.length === additionCount && events.length === eventCount, 'Expected repeated reports not to add capabilities or repeat Flows');
	await device.applyState({});
	await device.onInit();
	assert(additions.every((capability) => caps.has(capability)), 'Expected reported capabilities to survive omitted fields and restart');
	assert(additions.length === additionCount, 'Expected restart not to add unreported capabilities');
}

async function testWaterMeterPartialAlarmMessages()
{
	const { device, caps, triggers, events } = createWaterMeterDevice();
	device.refreshState = async () => true;
	await device.onInit();
	const message = {
		event: 'WaterMeterController.Alert',
		deviceId: 'meter',
		data: { alarm: { durationOverrun: true, amountOverrun: true, freezeError: true, lowTemp: true, highTemp: true, openReminder: true, reminder: true }, state: { valve: 'close' } },
	};
	await device.processMQTTMessage(message);
	await device.processMQTTMessage(message);
	assert(triggers.length === 7, 'Expected one trigger per newly active alarm, not per repeated report');
	assert(caps.get('alarm_generic.duration_overrun') === true && caps.get('alarm_generic.amount_overrun') === true, 'Expected both overrun alarms');
	assert(caps.get('alarm_cold.freeze') === true && caps.get('alarm_cold.low_temperature') === true && caps.get('alarm_heat.high_temperature') === true, 'Expected temperature alarms');
	assert(caps.get('alarm_water') === false && caps.get('alarm_problem') === false, 'Expected omitted alarms to remain unchanged');
	assert(caps.get('onoff') === false, 'Expected valve update without attributes');
	await device.processMQTTMessage({ event: 'WaterMeterController.Report', deviceId: 'meter', data: { alarm: { durationOverrun: false } } });
	assert(caps.get('alarm_generic.duration_overrun') === false && caps.get('alarm_generic.amount_overrun') === true, 'Expected only reported alarm to clear');
	assert(events.filter((event) => event.name === 'alarmCleared' && event.state.alarm === 'durationOverrun').length === 1, 'Expected a clear trigger for the selected alarm');
	await device.processMQTTMessage({ event: 'WaterMeterController.Alert', deviceId: 'meter', data: { alarm: { durationOverrun: true } } });
	assert(triggers.filter((alarm) => alarm === 'durationOverrun').length === 2, 'Expected a new trigger after clearing');
	assert(await device.processMQTTMessage({ event: 'WaterMeterController.Alert', deviceId: 'other', data: message.data }) === false, 'Expected other device to be ignored');
}

async function testWaterMeterDirectStartupResponse()
{
	const { device, caps } = createWaterMeterDevice();
	for (const capability of ['meter_water', 'meter_water.recent_usage', 'measure_flushes', 'measure_battery'])
	{
		caps.set(capability, null);
	}
	let refresh;
	let requests = 0;
	device.driver.getState = async () =>
	{
		requests += 1;
		return { data: {
			attributes: { meterUnit: 3 },
			state: { valve: 'open', meter: 100, waterFlowing: false },
			alarm: { durationOverrun: false, amountOverrun: true },
			dailyUsage: 42,
			recentUsage: { amount: 5, duration: 0 },
			temperature: 18.5,
			battery: 4,
			powerSupply: 'battery',
			valveDelay: { off: 0 },
		} };
	};
	device.refreshState = () =>
	{
		refresh = device.updateState();
		return refresh;
	};
	await device.onInit();
	await refresh;
	assert(requests === 1, 'Expected one state request during initialization');
	assert(caps.get('water_flowing') === false && caps.get('onoff') === true, 'Expected startup valve and flow state');
	assert(caps.get('alarm_generic.duration_overrun') === false && caps.get('alarm_generic.amount_overrun') === true, 'Expected startup alarms');
	assert(caps.get('measure_temperature') === 18.5 && caps.get('measure_water_duration') === 0, 'Expected startup temperature and zero duration');
	assert(caps.get('water_meter_power_source') === 'battery' && caps.get('measure_valve_delay.close') === 0, 'Expected startup power and zero delay');
	assert(!caps.has('measure_valve_delay.open'), 'Expected unreported optional delay to remain absent');
	assert(caps.get('meter_water.daily') === 42 && caps.get('measure_battery') === 100, 'Expected startup meter and battery');
}

async function testWaterMeterControllerAlarmVariants()
{
	const { device, caps, triggers, events } = createWaterMeterDevice();
	device.refreshState = async () => true;
	await device.onInit();
	await device.processMQTTMessage({
		event: 'WaterMeterController.Report',
		deviceId: 'meter',
		data: { alarm: { overrunDurationOnce: false, overrunAmount24H: false, overrunTimes24H: false } },
	});
	assert(caps.get('alarm_generic.duration_overrun') === false && caps.get('alarm_generic.amount_overrun') === false, 'Expected controller-specific alarms to initialize');
	assert(caps.get('alarm_generic.times_overrun') === false, 'Expected daily count alarm to initialize');
	assert(!caps.has('alarm_generic.open_reminder') && !caps.has('measure_temperature'), 'Expected unsupported fields to remain absent');
	await device.processMQTTMessage({
		event: 'WaterMeterController.Alert',
		deviceId: 'meter',
		data: { alarm: { overrunDurationOnce: true, overrunAmount24H: true, overrunTimes24H: true } },
	});
	assert(triggers.join(',') === 'durationOverrun,amountOverrun,overrunTimes24H', 'Expected triggers for all controller-specific alarms');
	await device.processMQTTMessage({ event: 'WaterMeterController.Alert', deviceId: 'meter', data: { alarm: { amountOverrun: true, overrunAmount24H: false } } });
	assert(caps.get('alarm_generic.amount_overrun') === true, 'Expected amount alarm to remain active while either source is active');
	await device.processMQTTMessage({ event: 'WaterMeterController.Report', deviceId: 'meter', data: { alarm: { amountOverrun: false, overrunDurationOnce: false, overrunTimes24H: false } } });
	assert(caps.get('alarm_generic.duration_overrun') === false && caps.get('alarm_generic.amount_overrun') === false && caps.get('alarm_generic.times_overrun') === false, 'Expected alarms to clear');
	assert(events.filter((event) => event.name === 'alarmCleared').length === 3, 'Expected one clear trigger per alarm');
}

async function testWaterMeterAlarmTitleMigration()
{
	const { device, caps } = createWaterMeterDevice();
	caps.set('alarm_generic.amount_overrun', false);
	let options = { title: { en: 'Water amount alarm' }, preventInsights: true };
	let updates = 0;
	device.getCapabilityOptions = () => options;
	device.setCapabilityOptions = async (capability, value) =>
	{
		assert(capability === 'alarm_generic.amount_overrun', 'Expected existing alarm capability to be updated');
		options = value;
		updates += 1;
	};
	device.refreshState = async () => true;
	await device.onInit();
	assert(options.title.en === 'Overrun Amount Alarm' && options.title.nl && options.preventInsights, 'Expected translated title and existing options to be preserved');
	await device.onInit();
	assert(updates === 1, 'Expected title migration to run only once');
	options = { title: { en: 'Amount alarm (incl. 24h)' }, preventInsights: true };
	await device.onInit();
	assert(options.title.en === 'Overrun Amount Alarm' && options.title.ko, 'Expected the previous title to be migrated');
	options = { title: { en: 'Overrun Amount Alarm', nl: 'Aangepast' } };
	await device.onInit();
	assert(options.title.nl === 'Aangepast' && options.title.fr, 'Expected existing translations to be preserved');
	options = { title: { en: 'Custom alarm' } };
	const previousUpdates = updates;
	await device.onInit();
	assert(updates === previousUpdates, 'Expected a custom title to remain unchanged');
}

async function testWaterMeterPartialResponse()
{
	const { device, caps } = createWaterMeterDevice();
	device.refreshState = async () => true;
	await device.onInit();
	await device.processMQTTMessage({ targetDevice: 'meter', data: { state: { valve: 'close', waterFlowing: true }, alarm: { durationOverrun: true } } });
	assert(caps.get('onoff') === false && caps.get('water_flowing') === true, 'Expected unwrapped response state');
	assert(caps.get('alarm_generic.duration_overrun') === true, 'Expected unwrapped response alarm');
}

async function testWaterMeterFlowFiltering()
{
	const driver = new WaterMeterDriver();
	const listeners = {};
	driver.homey = {
		app: { updateLog: () => {} },
		flow: { getDeviceTriggerCard: (id) => ({ registerRunListener: (fn) => { listeners[id] = fn; } }) },
	};
	await driver.onInit();
	for (const id of ['water_meter_alarm', 'water_meter_alarm_cleared'])
	{
		assert(await listeners[id]({ alarm: 'durationOverrun' }, { alarm: 'durationOverrun' }), 'Expected selected alarm to match');
		assert(!(await listeners[id]({ alarm: 'amountOverrun' }, { alarm: 'durationOverrun' })), 'Expected other alarms to be filtered');
	}
	assert(await listeners.water_meter_valve_delay_changed({ delay: 'open' }, { delay: 'open' }), 'Expected selected delay to match');
	assert(!(await listeners.water_meter_valve_delay_changed({ delay: 'close' }, { delay: 'open' })), 'Expected other delays to be filtered');
}

async function testWaterMeterChangeTriggers()
{
	const { device, events } = createWaterMeterDevice();
	device.refreshState = async () => true;
	await device.onInit();
	const initial = { state: { waterFlowing: false }, recentUsage: { duration: 0 }, powerSupply: 'battery', valveDelay: { on: 0, off: 2 } };
	await device.processMQTTMessage({ event: 'WaterMeterController.Report', deviceId: 'meter', data: initial });
	assert(!events.some((event) => event.name === 'flowStopped' || event.name === 'alarmCleared'), 'Expected no stop or clear trigger for initial inactive state');
	events.length = 0;
	const changed = { state: { waterFlowing: true }, recentUsage: { duration: 5 }, powerSupply: 'PowerLine', valveDelay: { on: 3, off: 0 } };
	await device.processMQTTMessage({ event: 'WaterMeterController.Report', deviceId: 'meter', data: changed });
	await device.processMQTTMessage({ event: 'WaterMeterController.Report', deviceId: 'meter', data: changed });
	assert(events.length === 5 && events.every((event) => event.target === device), 'Expected one device trigger per changed capability');
	assert(events.some((event) => event.name === 'flowStarted'), 'Expected flow start');
	assert(events.some((event) => event.name === 'durationChanged' && event.tokens.duration === 5), 'Expected duration token');
	assert(events.some((event) => event.name === 'powerChanged' && event.tokens.source === 'line'), 'Expected power source token');
	assert(events.some((event) => event.name === 'valveDelayChanged' && event.state.delay === 'open' && event.tokens.minutes === 3), 'Expected open delay token');
	assert(events.some((event) => event.name === 'valveDelayChanged' && event.state.delay === 'close' && event.tokens.minutes === 0), 'Expected close delay token');
	await device.processMQTTMessage({ event: 'WaterMeterController.Report', deviceId: 'meter', data: { state: { waterFlowing: false } } });
	assert(events.filter((event) => event.name === 'flowStopped').length === 1, 'Expected flow stop');
}

async function testWaterMeterFlowManifest()
{
	const cards = new Map(waterMeterFlows.triggers.map((card) => [card.id, card]));
	for (const id of ['water_meter_alarm', 'water_meter_alarm_cleared', 'water_meter_flow_started', 'water_meter_flow_stopped', 'water_meter_duration_changed', 'water_meter_power_changed', 'water_meter_valve_delay_changed'])
	{
		assert(cards.has(id), `Missing water meter trigger ${id}`);
	}
	const alarms = ['durationOverrun', 'amountOverrun', 'overrunTimes24H', 'openReminder', 'reminder', 'freezeError', 'lowTemp', 'highTemp'];
	for (const id of ['water_meter_alarm', 'water_meter_alarm_cleared'])
	{
		const choices = cards.get(id).args.find((arg) => arg.name === 'alarm').values.map((value) => value.id);
		assert(alarms.every((alarm) => choices.includes(alarm)), `Missing alarm choice in ${id}`);
	}
	for (const [id, token, type] of [['water_meter_duration_changed', 'duration', 'number'], ['water_meter_power_changed', 'source', 'string'], ['water_meter_valve_delay_changed', 'minutes', 'number']])
	{
		assert(cards.get(id).tokens.some((item) => item.name === token && item.type === type), `Missing token ${token} in ${id}`);
	}
}

async function testWaterMeterCapabilityTranslations()
{
	const locales = fs.readdirSync(path.join(__dirname, '..', 'locales'))
		.filter((file) => file.endsWith('.json')).map((file) => file.slice(0, -5));
	const options = require('../drivers/water-meter-controller/driver.compose.json').capabilitiesOptions;
	const definitions = [
		require('../.homeycompose/capabilities/water_flowing.json'),
		require('../.homeycompose/capabilities/measure_water_duration.json'),
		require('../.homeycompose/capabilities/measure_valve_delay.json'),
		require('../.homeycompose/capabilities/water_meter_power_source.json'),
	];
	const titles = Object.values(options).map((option) => option.title);
	for (const definition of definitions)
	{
		titles.push(definition.title);
		if (definition.titleTrue) titles.push(definition.titleTrue);
		if (definition.titleFalse) titles.push(definition.titleFalse);
		if (definition.values) titles.push(...definition.values.map((value) => value.title));
	}
	for (const title of titles)
	{
		assert(title && typeof title === 'object', 'Expected capability title to be a translation object');
		for (const locale of locales)
		{
			assert(typeof title[locale] === 'string' && title[locale].trim(), `Missing capability title for ${locale}`);
		}
	}
}

async function main()
{
	const results = [];
	results.push(await runTest('battery level 0 is reported as 0%', testBatteryPercentageReportsEmptyBattery));
	results.push(await runTest('humidity removed for temperature-only sensor', testHumidityRemovedForTemperatureOnlySensor));
	results.push(await runTest('humidity kept for humidity sensor', testHumidityKeptForHumiditySensor));
	results.push(await runTest('humidity restored when reported later', testHumidityRestoredWhenReportedLater));
	results.push(await runTest('water meter capabilities migrate and restore state', testWaterMeterMigrationAndState));
	results.push(await runTest('water meter adds only valid reported optional capabilities', testWaterMeterDynamicCapabilities));
	results.push(await runTest('water meter initializes from direct YoLink state response', testWaterMeterDirectStartupResponse));
	results.push(await runTest('water meter handles controller-specific overrun alarms', testWaterMeterControllerAlarmVariants));
	results.push(await runTest('water meter updates existing amount alarm title', testWaterMeterAlarmTitleMigration));
	results.push(await runTest('water meter handles partial alarm events', testWaterMeterPartialAlarmMessages));
	results.push(await runTest('water meter handles partial command responses', testWaterMeterPartialResponse));
	results.push(await runTest('water meter Flow filters by alarm type', testWaterMeterFlowFiltering));
	results.push(await runTest('water meter triggers only changed reported values', testWaterMeterChangeTriggers));
	results.push(await runTest('water meter Flow cards expose all new triggers', testWaterMeterFlowManifest));
	results.push(await runTest('water meter capabilities have translations for supported locales', testWaterMeterCapabilityTranslations));

	const failed = results.filter((result) => !result.ok);
	if (failed.length > 0)
	{
		console.error(`\n${failed.length} device harness test(s) failed.`);
		process.exitCode = 1;
		return;
	}

	console.log('\nAll device harness tests passed.');
}

main().catch((error) =>
{
	console.error('Device harness execution failed.');
	console.error(error);
	process.exitCode = 1;
});
