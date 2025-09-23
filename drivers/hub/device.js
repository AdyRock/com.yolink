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
		if (!state || !state.data || !state.data.wifi || !state.data.wifi.ip)
		{
			if (state.desc)
			{
				this.setUnavailable(state.desc);
			}
			else
			{
				this.setUnavailable('Offline');
			}
			return;
		}
		this.setAvailable();

		this.setCapabilityValue('info', state.data.wifi.ip);
	}
};
