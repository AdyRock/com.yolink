'use strict';

const Homey = require('homey');

module.exports = class MyDevice extends Homey.Device
{

	/**
   * onInit is called when the device is initialized.
   */
	async onInit()
	{
		this.updateState();
		this.log('MyDevice has been initialized');
	}

	/**
   * onAdded is called when the user adds the device, called just after pairing.
   */
	async onAdded()
	{
		this.updateState();
		this.log('MyDevice has been added');
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
		this.log('MyDevice settings where changed');
	}

	/**
   * onRenamed is called when the user updates the device's name.
   * This method can be used this to synchronise the name to the device.
   * @param {string} name The new name
   */
	async onRenamed(name)
	{
		this.log('MyDevice was renamed');
	}

	/**
   * onDeleted is called when the user deleted the device.
   */
	async onDeleted()
	{
		this.log('MyDevice has been deleted');
	}

	async updateState()
	{
		const data = await this.getData();
		const state = await this.driver.getState(data);
		if (!state || !state.state || !state.state.operational_state)
		{
			this.setUnavailable('Offline');
			return;
		}
		this.setAvailable();

		this.setCapabilityValue('alarm_contact', state.state.contact === 'open');
		this.setCapabilityValue('alarm_door_fault', state.state.operational_state === 'error');

		// The returned battery is a string with a level between 0 and 4, so convert to 0 to 1
		if (state.state.battery)
		{
			const batteryLevel = parseInt(state.state.battery, 10) / 4;
			this.setCapabilityValue('measure_battery', batteryLevel);
		}
	}
};
