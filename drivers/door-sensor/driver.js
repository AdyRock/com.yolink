'use strict';

// const Homey = require('homey');
const yoLinkDriver = require('../yoLinkDriver');

module.exports = class DoorSensorDriver extends yoLinkDriver
{
	/**
	 * onInit is called when the driver is initialized.
	 */
	async onInit()
	{
		this.deviceType = 'DoorSensor';
		this.log('MyDriver has been initialized');
	}

};
