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
		if (changedKeys.includes('tankDepth'))
		{
			const tankDepth = Number(newSettings.tankDepth);
			if (!Number.isFinite(tankDepth) || tankDepth <= 0)
			{
				throw new Error('Tank depth must be a positive number.');
			}
		}

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
		const tankMaxDepth = Number(settings.tankDepth);
		const state = await this.driver.getState(data, settings);
		this.unsetWarning().catch(this.error);
		if (!state || !state.data || !state.data.online || state.data.online !== true)
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

		this.setCapabilityValue('alarm_water.low', state.data.state.alarm.lowAlarm).catch(this.error);
		this.setCapabilityValue('alarm_water.high', state.data.state.alarm.highAlarm).catch(this.error);
		const actualPercentage = this.calculateWaterDepthPercentage(state.data.state.waterDepth, tankMaxDepth);
		this.setCapabilityValue('measure_water_depth', actualPercentage).catch(this.error);

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
		const settings = await this.getSettings();
		const tankMaxDepth = Number(settings.tankDepth);
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
			const actualPercentage = this.calculateWaterDepthPercentage(mqttData.state.waterDepth, tankMaxDepth);
			this.setCapabilityValue('measure_water_depth', actualPercentage).catch(this.error);
		}

		return true;
	}

	calculateWaterDepthPercentage(rawWaterDepth, tankMaxDepth)
	{
		const rawDepth = Number(rawWaterDepth);
		if (!Number.isFinite(rawDepth))
		{
			return 0;
		}

		if (!Number.isFinite(tankMaxDepth) || tankMaxDepth <= 0)
		{
			return rawDepth;
		}

		const currentDepth = rawDepth / 10;

		return (currentDepth / tankMaxDepth) * 100;
	}
};
