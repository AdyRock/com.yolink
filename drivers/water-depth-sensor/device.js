'use strict';

const Homey = require('homey');

module.exports = class WaterDepthSensorDevice extends Homey.Device
{

	/**
	 * onInit is called when the device is initialized.
	 */
	async onInit()
	{
		this.updateState();
		this.log('WaterDepthSensorDevice has been initialized');
	}

	/**
	 * onAdded is called when the user adds the device, called just after pairing.
	 */
	async onAdded()
	{
		this.log('WaterDepthSensorDevice has been added');
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
		this.log('WaterDepthSensorDevice settings where changed');
	}

	/**
	 * onRenamed is called when the user updates the device's name.
	 * This method can be used this to synchronise the name to the device.
	 * @param {string} name The new name
	 */
	async onRenamed(name)
	{
		this.log('WaterDepthSensorDevice was renamed');
	}

	/**
	 * onDeleted is called when the user deleted the device.
	 */
	async onDeleted()
	{
		this.log('WaterDepthSensorDevice has been deleted');
	}

	async updateState()
	{
		const data = await this.getData();
		const settings = await this.getSettings();
		const state = await this.driver.getState(data, settings);
		if (!state || !state.data || !state.data.online || state.data.online !== true)
		{
			this.setUnavailable('Offline').catch(this.error);
			return;
		}
		this.setAvailable().catch(this.error);

		this.setCapabilityValue('alarm_water.low', state.data.state.alarm.lowAlarm).catch(this.error);
		this.setCapabilityValue('alarm_water.high', state.data.state.alarm.highAlarm).catch(this.error);
		this.setCapabilityValue('measure_water_depth', state.data.state.waterDepth / 10).catch(this.error);

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

		// Log the device status
		this.homey.app.updateLog(`WaterDepthSensorDevice MQTT message received: ${JSON.stringify(mqttData)}`);

		// Process the MQTT message
		if (mqttData.battery)
		{
			const batteryLevel = parseInt(mqttData.battery, 10) / 0.04;
			this.setCapabilityValue('measure_battery', batteryLevel).catch(this.error);
		}

		if (mqttData.state)
		{
			this.setCapabilityValue('alarm_water.low', mqttData.state.alarm.lowAlarm).catch(this.error);
			this.setCapabilityValue('alarm_water.high', mqttData.state.alarm.highAlarm).catch(this.error);
			this.setCapabilityValue('measure_water_depth', mqttData.state.waterDepth / 10).catch(this.error);
		}

		return true;
	}
};
