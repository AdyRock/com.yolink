'use strict';

const Homey = require('homey');

module.exports = class WaterMeterControllerDevice extends Homey.Device
{

	/**
	 * onInit is called when the device is initialized.
	 */
	async onInit()
	{
		// Add the capability listener for the OnOff capability
		this.registerCapabilityListener('onoff', this.onOffCapabilityListener.bind(this));

		if (!this.hasCapability('meter_water.daily'))
		{
			this.addCapability('meter_water.daily').catch(this.error);
		}

		this.updateState();
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
		this.log('WaterMeterControllerDevice settings where changed');
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

		const respone = await this.homey.app.yoLinkAPI.controlDevice(data.UAID, data.id, data.deviceToken, settings.serviceZone, 'WaterMeterController.setState', { valve: value ? 'open' : 'close' });

		if (respone.desc !== 'Success')
		{
			this.homey.app.updateLog(`Failed to control Water Valve: ${respone.desc}`);
			throw new Error(`Failed to control Water Valve ${respone.desc}`);
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
			if (state && state === 'error')
			{
				this.homey.app.updateLog(`Error updating state for device ${data.id}: ${state.msg}`, 0);
				this.setWarning(`Error: ${state.msg}`).catch(this.error);
				return;
			}
			this.setUnavailable('Offline').catch(this.error);
			return;
		}
		this.setAvailable().catch(this.error);

		let meterConversion = (1 / state.data.state.attributes.meterStepFactor) * 100000; // The meter value is returned in centiliters, so convert to liters
		if (state.data.state.attributes.meterUnit === 0)
		{
			// Meter unit is in Gallons, so convert to liters
			meterConversion = 3.78541;
		}
		else if (state.data.state.attributes.meterUnit === 1)
		{
			// Meter unit is in cubic feet, so convert to liters
			meterConversion = 28.3168;
		}
		else if (state.data.state.attributes.meterUnit === 2)
		{
			// Meter unit is in M3, so convert to liters
			meterConversion = 1000;
		}

		this.setCapabilityValue('meter_water.recent_usage', state.data.state.recentUsage.amount / meterConversion).catch(this.error);
		this.setCapabilityValue('alarm_water', state.data.state.alarm.leak).catch(this.error);
		this.setCapabilityValue('alarm_problem', state.data.state.alarm.valveError).catch(this.error);
		this.setCapabilityValue('measure_flushes', state.data.state.dailyUsage.times).catch(this.error);
		this.setCapabilityValue('meter_water.daily', state.data.state.dailyUsage.amount / meterConversion).catch(this.error);
		this.setCapabilityValue('meter_water', state.data.state.state.meter / meterConversion).catch(this.error);
		this.setCapabilityValue('onoff', state.data.state.state.valve === 'open').catch(this.error);

		// The returned battery is a string with a level between 0 and 4, so convert to 0 to 1
		if (state.data.state.battery)
		{
			const batteryLevel = parseInt(state.data.state.battery, 10) / 0.04;
			this.setCapabilityValue('measure_battery', batteryLevel).catch(this.error);
		}

		this.driver.updateMQTTState(data);
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
			mqttData = mqttMessage.data.state;
			deviceId = mqttMessage.targetDevice;
		}

		if (deviceId !== this.getData().id)
		{
			return false;
		}

		if (!mqttData)
		{
			return true;
		}

		// Log the device status
		this.homey.app.updateLog(`WaterMeterControllerDevice MQTT message received: ${JSON.stringify(mqttData)}`);

		let meterConversion = (1 / mqttData.attributes.meterStepFactor) * 100000; // The meter value is returned in centiliters, so convert to liters
		if (mqttData.attributes.meterUnit === 0)
		{
			// Meter unit is in Gallons, so convert to liters
			meterConversion = 3.78541;
		}
		else if (mqttData.attributes.meterUnit === 1)
		{
			// Meter unit is in cubic feet, so convert to liters
			meterConversion = 28.3168;
		}
		else if (mqttData.attributes.meterUnit === 2)
		{
			// Meter unit is in M3, so convert to liters
			meterConversion = 1000;
		}

		if (mqttData.alarm)
		{
			this.setCapabilityValue('alarm_water', mqttData.alarm.leak).catch(this.error);
			this.setCapabilityValue('alarm_problem', mqttData.alarm.valveError).catch(this.error);
		}

		if (mqttData.dailyUsage)
		{
			this.setCapabilityValue('measure_flushes', mqttData.dailyUsage.times).catch(this.error);
			this.setCapabilityValue('meter_water.daily', mqttData.dailyUsage.amount / meterConversion).catch(this.error);
		}

		if (mqttData.state)
		{
			this.setCapabilityValue('meter_water', mqttData.state.meter / meterConversion).catch(this.error);
		}

		if (mqttData.state && mqttData.state.valve)
		{
			this.setCapabilityValue('onoff', mqttData.state.valve === 'open').catch(this.error);
		}

		// Process the MQTT message
		if (mqttData.battery)
		{
			const batteryLevel = parseInt(mqttData.battery, 10) / 0.04;
			this.setCapabilityValue('measure_battery', batteryLevel).catch(this.error);
		}

		return true;
	}
};
