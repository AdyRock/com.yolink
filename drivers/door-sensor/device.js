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
		this.homey.setInterval(() => this.updateState(), 15 * 1000);
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
		if (!state || !state.data || !state.data.online || state.data.online !== true)
		{
			this.setUnavailable('Offline');
			return;
		}
		this.setAvailable();

		this.setCapabilityValue('alarm_contact', state.data.state.state === 'open');

		// If the door is open and the time now is greater than the openRemindDelay + the stateChangedAt time, then set the alarm_door_fault to true
		if ((state.data.state.state === 'open') && (Date.now() > (state.data.state.stateChangedAt + (state.data.state.openRemindDelay * 1000))))
		{
			this.setCapabilityValue('alarm_door_fault', true);
		}
		else
		{
			this.setCapabilityValue('alarm_door_fault', false);
		}

		// The returned battery is a string with a level between 0 and 4, so convert to 0 to 1
		if (state.data.state.battery)
		{
			const batteryLevel = parseInt(state.data.state.battery, 10) / 4;
			this.setCapabilityValue('measure_battery', batteryLevel);
		}
	}
};
