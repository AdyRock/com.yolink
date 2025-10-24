'use strict';

const yoLinkDriver = require('../yoLinkDriver');

module.exports = class SirenDriver extends yoLinkDriver
{
	/**
	 * onInit is called when the driver is initialized.
	 */
	async onInit()
	{
		this.deviceType = 'Siren';

		this.sirenTurnedOn = this.homey.flow.getDeviceTriggerCard('siren_alert');
		this.sirenTurnedOff = this.homey.flow.getDeviceTriggerCard('siren_off');

		this.homey.flow.getActionCard('siren_on')
			.registerRunListener(async (args, state) =>
			{
				args.device.triggerCapabilityListener('sirenOnOff', true, null);
				return true;
			});

		this.homey.flow.getActionCard('siren_off')
			.registerRunListener(async (args, state) =>
			{
				args.device.triggerCapabilityListener('sirenOnOff', false, null);
				return true;
			});

		this.homey.app.updateLog('SirenDriver has been initialized');
	}

	triggerSirenOnFlow(device)
	{
		this.sirenTurnedOn
			.trigger(device, null, null)
			.then(this.log)
			.catch(this.error);
	}

	triggerSirenOffFlow(device)
	{
		this.sirenTurnedOff
			.trigger(device, null, null)
			.then(this.log)
			.catch(this.error);
	}
};
