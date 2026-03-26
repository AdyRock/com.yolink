'use strict';

const yoLinkDriver = require('../yoLinkDriver');

module.exports = class GarageDoorDriver extends yoLinkDriver
{
	/**
	 * onInit is called when the driver is initialized.
	 */
	async onInit()
	{
		this.deviceType = 'DoorSensor';
		this.subType = 'GarageDoor';
		this.homey.app.updateLog('GarageDoorDriver has been initialized');
	}
};
