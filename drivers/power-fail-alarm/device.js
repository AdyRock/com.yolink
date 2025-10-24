'use strict';

const Homey = require('homey');

module.exports = class PowerFailDevice extends Homey.Device
{

	/**
	 * onInit is called when the device is initialized.
	 */
	async onInit()
	{
		this.updateState();
		this.homey.app.updateLog('PowerFailDevice has been initialized');
	}

	/**
	 * onAdded is called when the user adds the device, called just after pairing.
	 */
	async onAdded()
	{
		this.updateState();
		this.homey.app.updateLog('PowerFailDevice has been added');
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
		this.homey.app.updateLog('PowerFailDevice settings where changed');
	}

	/**
	 * onRenamed is called when the user updates the device's name.
	 * This method can be used this to synchronise the name to the device.
	 * @param {string} name The new name
	 */
	async onRenamed(name)
	{
		this.homey.app.updateLog('PowerFailDevice was renamed');
	}

	/**
	 * onDeleted is called when the user deleted the device.
	 */
	async onDeleted()
	{
		this.homey.app.updateLog('PowerFailDevice has been deleted');
	}

	async updateState()
	{
		const data = await this.getData();
		const settings = await this.getSettings();
		const state = await this.driver.getState(data, settings);
		if (!state || !state.data)
		{
			this.setUnavailable('Offline');
			return;
		}
		this.setAvailable();

		this.setCapabilityValue('alarm_power', state.data.state === 'alert');

		// The returned battery is a string with a level between 0 and 4, so convert to 0 to 1
		if (state.data.battery)
		{
			const batteryLevel = parseInt(state.data.battery, 10) / 0.04;
			this.setCapabilityValue('measure_battery', batteryLevel);
		}

		this.driver.updateMQTTState(data);
	}

	async processMQTTMessage(mqttMessage)
	{
		// Check if the event field is present so we know what type of message this is
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
			deviceId = mqttMessage.data.deviceId;
		}

		if (deviceId !== this.getData().id)
		{
			return;
		}

		this.setCapabilityValue('alarm_power', mqttData.state === 'alert');

		if (mqttData.battery)
		{
			const batteryLevel = parseInt(mqttData.battery, 10) / 0.04;
			this.setCapabilityValue('measure_battery', batteryLevel);
		}
	}
};
