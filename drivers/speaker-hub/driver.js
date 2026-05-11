'use strict';

const yoLinkDriver = require('../yoLinkDriver');

module.exports = class SpeakerHubDriver extends yoLinkDriver
{
	getIsBusyResponse(response)
	{
		return response && (response.code === '020104' || response.desc === 'Device is busy, try again later.');
	}

	async delay(ms)
	{
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	async controlPlayAudioWithRetry(data, settings, params, attempt = 0)
	{
		const response = await this.homey.app.yoLinkAPI.controlDevice(data.UAID, data.id, data.deviceToken, settings.serviceZone, 'SpeakerHub.playAudio', params);
		const maxRetries = 3;

		if (this.getIsBusyResponse(response) && attempt < maxRetries)
		{
			const backoffMs = 500 * (2 ** attempt);
			this.homey.app.updateLog(`SpeakerHub busy response received, retrying in ${backoffMs} ms (attempt ${attempt + 1}/${maxRetries})`);
			await this.delay(backoffMs);
			return this.controlPlayAudioWithRetry(data, settings, params, attempt + 1);
		}

		return response;
	}

	/**
	 * onInit is called when the driver is initialized.
	 */
	async onInit()
	{
		this.deviceType = 'SpeakerHub';

		this.homey.flow.getActionCard('play_tone')
			.registerRunListener(async (args, state) =>
			{
				const data = await args.device.getData();
				const settings = await args.device.getSettings();
				return this.controlPlayAudioWithRetry(data, settings, { tone: args.tone, volume: args.volume, repeat: parseInt(args.repeat, 10) });
			});

		this.homey.flow.getActionCard('play_message')
			.registerRunListener(async (args, state) =>
			{
				const data = await args.device.getData();
				const settings = await args.device.getSettings();
				return this.controlPlayAudioWithRetry(data, settings, { message: args.message, volume: args.volume, repeat: parseInt(args.repeat, 10) });
			});

		this.homey.app.updateLog('SpeakerHubDriver has been initialized');
	}

};
