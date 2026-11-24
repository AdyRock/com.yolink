'use strict';

const YoLinkDevice = require('../yoLinkDevice');

const ALARM_CAPABILITIES = {
	leak: 'alarm_water',
	valveError: 'alarm_problem',
	durationOverrun: 'alarm_generic.duration_overrun',
	amountOverrun: 'alarm_generic.amount_overrun',
	overrunTimes24H: 'alarm_generic.times_overrun',
	openReminder: 'alarm_generic.open_reminder',
	reminder: 'alarm_generic.reminder',
	freezeError: 'alarm_cold.freeze',
	lowTemp: 'alarm_cold.low_temperature',
	highTemp: 'alarm_heat.high_temperature',
};

const ALARM_ALIASES = {
	durationOverrun: ['overrunDurationOnce'],
	amountOverrun: ['overrunAmount24H'],
};

module.exports = class WaterMeterControllerDevice extends YoLinkDevice
{

	/**
	 * onInit is called when the device is initialized.
	 */
	async onInit()
	{
		// Add the capability listener for the OnOff capability
		this.registerCapabilityListener('onoff', this.onOffCapabilityListener.bind(this));

		const amountAlarmOptions = this.hasCapability('alarm_generic.amount_overrun')
			? this.getCapabilityOptions('alarm_generic.amount_overrun') : null;
		const amountAlarmTitle = this.driver.manifest.capabilitiesOptions['alarm_generic.amount_overrun'].title;
		const existingTitle = amountAlarmOptions && amountAlarmOptions.title;
		const existingEnglish = typeof existingTitle === 'string' ? existingTitle : existingTitle && existingTitle.en;
		const oldTitle = existingEnglish === 'Water amount alarm' || existingEnglish === 'Amount alarm (incl. 24h)';
		const missingTranslations = existingEnglish === amountAlarmTitle.en
			&& Object.keys(amountAlarmTitle).some((language) => !existingTitle[language]);
		if (oldTitle || missingTranslations)
		{
			await this.setCapabilityOptions('alarm_generic.amount_overrun', {
				...amountAlarmOptions,
				title: oldTitle || typeof existingTitle === 'string' ? amountAlarmTitle : { ...amountAlarmTitle, ...existingTitle },
			}).catch((error) => this.error('Failed to update water amount alarm title', error));
		}

		this.refreshState().catch(this.error);
		this.log('WaterMeterControllerDevice has been initialized');
	}

	/**
	 * onAdded is called when the user adds the device, called just after pairing.
	 */
	async onAdded()
	{
		this.log('WaterMeterControllerDevice has been added');
	}

	/**
	 * onSettings is called when the user updates the device's settings.
	 * @param {object} event the onSettings event data
	 * @param {object} event.oldSettings The old settings object
	 * @param {object} event.newSettings The new settings object
	 * @param {string[]} event.changedKeys An array of keys changed since the previous version
	 * @returns {Promise<string|void>} return a custom message that will be displayed
	 */
	async onSettings({ oldSettings, newSettings, changedKeys })
	{
		this.log('WaterMeterControllerDevice settings were changed');
	}

	/**
	 * onRenamed is called when the user updates the device's name.
	 * This method can be used this to synchronise the name to the device.
	 * @param {string} name The new name
	 */
	async onRenamed(name)
	{
		this.log('WaterMeterControllerDevice was renamed');
	}

	/**
	 * onDeleted is called when the user deleted the device.
	 */
	async onDeleted()
	{
		this.log('WaterMeterControllerDevice has been deleted');
	}

	async onOffCapabilityListener(value)
	{
		const data = await this.getData();
		const settings = await this.getSettings();

		const response = await this.homey.app.yoLinkAPI.controlDevice(data.UAID, data.id, data.deviceToken, settings.serviceZone, 'WaterMeterController.setState', { valve: value ? 'open' : 'close' });

		if (!response || response.desc !== 'Success')
		{
			const responseDesc = response ? response.desc : 'No response';
			this.homey.app.updateLog(`Failed to control Water Valve: ${responseDesc}`);
			throw new Error(`Failed to control Water Valve ${responseDesc}`);
		}

		return true;
	}

	async updateState()
	{
		const data = await this.getData();
		const settings = await this.getSettings();
		const state = await this.driver.getState(data, settings);
		this.unsetWarning().catch(this.error);
		if (!state || !state.data)
		{
			if (state && state.state === 'error')
			{
				this.homey.app.updateLog(`Error updating state for device ${data.id}: ${state.msg}`, 0);
				this.setWarning(`Error: ${state.msg}`).catch(this.error);
				return false;
			}
			this.setUnavailable('Offline').catch(this.error);
			return false;
		}
		this.setAvailable().catch(this.error);

		await this.applyState(this.getReportedState(state.data));

		this.driver.updateMQTTState(data);

		return true;
	}

	async processMQTTMessage(mqttMessage)
	{
		let mqttData;
		let deviceId;
		// Check if the event field is present so we know what type of message this is
		if (mqttMessage.event)
		{
			mqttData = mqttMessage.data;
			deviceId = mqttMessage.deviceId;
		}
		else
		{
			mqttData = this.getReportedState(mqttMessage.data);
			deviceId = mqttMessage.targetDevice;
		}

		if (deviceId !== this.getData().id)
		{
			return false;
		}

		this.markOnline();

		if (!mqttData)
		{
			return true;
		}

		// Log the device status
		this.homey.app.updateLog(`WaterMeterControllerDevice MQTT message received: ${JSON.stringify(mqttData)}`);

		await this.applyState(mqttData);
		return true;
	}

	getReportedState(data)
	{
		if (data && data.state && (data.state.attributes || data.state.alarm || typeof data.state.state === 'object'))
		{
			return data.state;
		}
		return data;
	}

	async applyState(data)
	{
		if (!data || typeof data !== 'object')
		{
			throw new Error('Missing water meter state');
		}

		if (data.attributes)
		{
			const { meterUnit, meterStepFactor } = data.attributes;
			const conversions = [3.78541, 2831.68, 1000, 1];
			if (Number.isInteger(meterUnit) && meterUnit >= 0 && meterUnit < conversions.length)
			{
				this.meterConversion = conversions[meterUnit];
			}
			else if (typeof meterStepFactor === 'number' && meterStepFactor > 0)
			{
				this.meterConversion = 100000 / meterStepFactor;
			}
		}

		if (data.alarm && typeof data.alarm === 'object')
		{
			this.reportedAlarms = this.reportedAlarms || {};
			for (const [name, capability] of Object.entries(ALARM_CAPABILITIES))
			{
				const fields = [name, ...(ALARM_ALIASES[name] || [])];
				const reported = fields.filter((field) => typeof data.alarm[field] === 'boolean');
				if (reported.length > 0)
				{
					for (const field of reported)
					{
						this.reportedAlarms[field] = data.alarm[field];
					}
					const active = fields.some((field) => this.reportedAlarms[field] === true);
					const previous = await this.setReportedCapability(capability, active);
					if (name !== 'leak' && name !== 'valveError' && active && previous !== true)
					{
						await this.driver.waterMeterAlarm.trigger(this, {}, { alarm: name }).catch(this.error);
					}
					else if (name !== 'leak' && name !== 'valveError' && !active && previous === true)
					{
						await this.driver.waterMeterAlarmCleared.trigger(this, {}, { alarm: name }).catch(this.error);
					}
				}
			}
		}

		const deviceState = data.state;
		if (deviceState && typeof deviceState === 'object')
		{
			if (deviceState.valve === 'open' || deviceState.valve === 'close')
			{
				await this.setCapabilityValue('onoff', deviceState.valve === 'open');
			}
			if (typeof deviceState.waterFlowing === 'boolean')
			{
				const previous = await this.setReportedCapability('water_flowing', deviceState.waterFlowing);
				if (deviceState.waterFlowing && previous !== true)
				{
					await this.driver.waterMeterFlowStarted.trigger(this).catch(this.error);
				}
				else if (!deviceState.waterFlowing && previous === true)
				{
					await this.driver.waterMeterFlowStopped.trigger(this).catch(this.error);
				}
			}
		}

		if (typeof data.temperature === 'number' && Number.isFinite(data.temperature) && data.temperature >= -273.15)
		{
			await this.setReportedCapability('measure_temperature', data.temperature);
		}
		if (data.recentUsage && typeof data.recentUsage.duration === 'number' && Number.isFinite(data.recentUsage.duration) && data.recentUsage.duration >= 0)
		{
			const { duration } = data.recentUsage;
			await this.setChangedCapability('measure_water_duration', duration, this.driver.waterMeterDurationChanged, { duration });
		}
		if (data.dailyUsage && typeof data.dailyUsage.times === 'number')
		{
			await this.setCapabilityValue('measure_flushes', data.dailyUsage.times);
		}
		if (data.powerSupply === 'battery' || data.powerSupply === 'PowerLine')
		{
			const source = data.powerSupply === 'battery' ? 'battery' : 'line';
			await this.setChangedCapability('water_meter_power_source', source, this.driver.waterMeterPowerChanged, { source });
		}
		if (data.valveDelay && typeof data.valveDelay === 'object')
		{
			for (const [field, delay] of [['on', 'open'], ['off', 'close']])
			{
				if (typeof data.valveDelay[field] === 'number' && Number.isFinite(data.valveDelay[field]) && data.valveDelay[field] >= 0)
				{
					const minutes = data.valveDelay[field];
					await this.setChangedCapability(`measure_valve_delay.${delay}`, minutes, this.driver.waterMeterValveDelayChanged, { minutes }, { delay });
				}
			}
		}

		const meterValues = [
			['meter_water', deviceState && deviceState.meter],
			['meter_water.recent_usage', data.recentUsage && data.recentUsage.amount],
			['meter_water.daily', typeof data.dailyUsage === 'number' ? data.dailyUsage : data.dailyUsage && data.dailyUsage.amount],
		];
		for (const [capability, value] of meterValues)
		{
			if (typeof value === 'number' && Number.isFinite(value))
			{
				if (this.meterConversion)
				{
					await this.setReportedCapability(capability, value / this.meterConversion);
				}
				else
				{
					this.homey.app.updateLog(`Missing meter attributes for device ${this.getData().id}; cannot update ${capability}`, 0);
				}
			}
		}

		const batteryLevel = this.driver.getBatteryPercentage(data.battery);
		if (batteryLevel !== null)
		{
			await this.setCapabilityValue('measure_battery', batteryLevel);
		}
	}

	async setReportedCapability(capability, value)
	{
		if (!this.hasCapability(capability))
		{
			await this.addCapability(capability);
			const options = this.driver.manifest.capabilitiesOptions[capability];
			if (options)
			{
				await this.setCapabilityOptions(capability, options);
			}
		}
		const previous = this.getCapabilityValue(capability);
		await this.setCapabilityValue(capability, value);
		return previous;
	}

	async setChangedCapability(capability, value, trigger, tokens, state = {})
	{
		const previous = await this.setReportedCapability(capability, value);
		if (previous !== value)
		{
			await trigger.trigger(this, tokens, state).catch(this.error);
		}
	}
};
