'use strict';

const Homey = require('homey');

module.exports = class THDevice extends Homey.Device
{

	/**
	 * onInit is called when the device is initialized.
	 */
	async onInit()
	{
		this.updateState();
		this.log('THDevice has been initialized');
	}

	/**
	 * onAdded is called when the user adds the device, called just after pairing.
	 */
	async onAdded()
	{
		this.log('THDevice has been added');
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
		this.log('THDevice settings where changed');
	}

	/**
	 * onRenamed is called when the user updates the device's name.
	 * This method can be used this to synchronise the name to the device.
	 * @param {string} name The new name
	 */
	async onRenamed(name)
	{
		this.log('THDevice was renamed');
	}

	/**
	 * onDeleted is called when the user deleted the device.
	 */
	async onDeleted()
	{
		this.log('THDevice has been deleted');
	}

	async updateState()
	{
		const data = await this.getData();
		const state = await this.driver.getState(data);
		if (!state || !state.data || !state.data.online || state.data.online !== true)
		{
			this.setUnavailable('Offline');
			return;
		}
		this.setAvailable();

		this.setCapabilityValue('measure_temperature', state.data.state.temperature);
		this.setCapabilityValue('measure_humidity', state.data.state.humidity);

		// The returned battery is a string with a level between 0 and 4, so convert to 0 to 1
		if (state.data.state.battery)
		{
			const batteryLevel = parseInt(state.data.state.battery, 10) / 0.04;
			this.setCapabilityValue('measure_battery', batteryLevel);
		}
	}

	async processMQTTMessage(mqttMessage)
	{
		if (mqttMessage.deviceId !== this.getData().id)
		{
			return;
		}

		// Process the MQTT message
		if (mqttMessage.event === 'THSensor.Report')
		{
			if (mqttMessage.data.temperature)
			{
				this.setCapabilityValue('measure_temperature', mqttMessage.data.temperature);
			}
			if (mqttMessage.data.humidity)
			{
				this.setCapabilityValue('measure_humidity', mqttMessage.data.humidity);
			}
			if (mqttMessage.data.battery)
			{
				const batteryLevel = parseInt(mqttMessage.data.battery, 10) / 0.04;
				this.setCapabilityValue('measure_battery', batteryLevel);
			}
		}
	}

};
