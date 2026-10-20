'use strict';

const Homey = require('homey');

module.exports = class MultiOutletDevice extends Homey.Device
{
	async onInit()
	{
		this.registerCapabilityListener('onoff', this.onOffCapabilityListener.bind(this));
		this.updateState().catch((err) => this.error(err));
		this.homey.app.updateLog('MultiOutletDevice has been initialized');
	}

	async onAdded()
	{
		this.updateState().catch((err) => this.error(err));
		this.homey.app.updateLog('MultiOutletDevice has been added');
	}

	async onOffCapabilityListener(value)
	{
		const data = await this.getData();
		const settings = await this.getSettings();
		if (data.outletIndex !== 0 && data.outletIndex !== 1)
		{
			throw new Error(`Invalid outlet index ${data.outletIndex}`);
		}

		const response = await this.homey.app.yoLinkAPI.controlDevice(
			data.UAID,
			data.deviceId,
			data.deviceToken,
			settings.serviceZone,
			'MultiOutlet.setState',
			{ chs: 1 << data.outletIndex, state: value ? 'open' : 'close' },
		);

		if (!response || response.desc !== 'Success')
		{
			this.homey.app.updateLog('Failed to control MultiOutlet');
			throw new Error(`Failed to control MultiOutlet ${response ? response.desc : 'No response'}`);
		}

		return true;
	}

	async updateState()
	{
		const data = await this.getData();
		const settings = await this.getSettings();
		const state = await this.driver.getState(data, settings);
		this.unsetWarning().catch(this.herror);
		if (!state || !state.data)
		{
			if (state && state.state === 'error')
			{
				this.homey.app.updateLog(`Error updating state for device ${data.deviceId}: ${state.msg}`, 0);
				this.setWarning(`Error: ${state.msg}`).catch(this.error);
				return;
			}
			this.setUnavailable('Offline').catch(this.error);
			return;
		}

		const outletState = Array.isArray(state.data.state) ? state.data.state[data.outletIndex] : null;
		if (typeof outletState !== 'string')
		{
			this.homey.app.updateLog(`Invalid outlet state for device ${data.deviceId}, outlet ${data.outletIndex + 1}`, 0);
			this.setWarning('Error: Invalid outlet state').catch(this.error);
			return;
		}

		this.setAvailable().catch(this.error);
		this.setCapabilityValue('onoff', outletState === 'open').catch(this.error);
		this.driver.updateMQTTState(data);
	}

	async processMQTTMessage(mqttMessage)
	{
		const data = await this.getData();
		if (mqttMessage.deviceId !== data.deviceId)
		{
			return false;
		}

		const states = mqttMessage.data && mqttMessage.data.state;
		if (!Array.isArray(states) || typeof states[data.outletIndex] !== 'string')
		{
			return false;
		}

		this.setAvailable().catch(this.error);
		this.setCapabilityValue('onoff', states[data.outletIndex] === 'open').catch(this.error);
		return true;
	}
};
