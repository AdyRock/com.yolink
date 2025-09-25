'use strict';

const Homey = require('homey');

module.exports = class DoorSensorDevice extends Homey.Device
{

	/**
   * onInit is called when the device is initialized.
   */
	async onInit()
	{
		this.updateState();
		this.homey.app.updateLog('MDoorSensorDevice has been initialized');
	}

	/**
   * onAdded is called when the user adds the device, called just after pairing.
   */
	async onAdded()
	{
		this.updateState();
		this.homey.app.updateLog('MDoorSensorDevice has been added');
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
		this.homey.app.updateLog('MDoorSensorDevice settings where changed');
	}

	/**
   * onRenamed is called when the user updates the device's name.
   * This method can be used this to synchronise the name to the device.
   * @param {string} name The new name
   */
	async onRenamed(name)
	{
		this.homey.app.updateLog('MDoorSensorDevice was renamed');
	}

	/**
   * onDeleted is called when the user deleted the device.
   */
	async onDeleted()
	{
		this.homey.app.updateLog('MDoorSensorDevice has been deleted');
	}

	async updateState()
	{
		const data = await this.getData();
		const settings = await this.getSettings();
		const state = await this.driver.getState(data, settings);
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
		if (mqttMessage.event === 'DoorSensor.Alert')
		{
			if (mqttMessage.data.alertType === 'openRemind')
			{
				this.setCapabilityValue('alarm_door_fault', true);
			}
			else
			{
				this.setCapabilityValue('alarm_door_fault', false);
			}

			this.setCapabilityValue('alarm_contact', mqttMessage.data.state === 'open');

			if (mqttMessage.data.battery)
			{
				const batteryLevel = parseInt(mqttMessage.data.battery, 10) / 0.04;
				this.setCapabilityValue('measure_battery', batteryLevel);
			}
		}
	}
};
